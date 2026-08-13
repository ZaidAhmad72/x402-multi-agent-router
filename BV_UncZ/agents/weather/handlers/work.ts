import type { Context } from 'hono';

// Deterministic only — no LLM call anywhere in this file, same constraint as
// formatter. Location extraction and the weather lookup ported from
// reference-implementation/server/src/agents/weatherAgent.ts.

const WEATHER_CODES: Record<number, string> = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'depositing rime fog',
  51: 'light drizzle', 53: 'moderate drizzle', 55: 'dense drizzle',
  61: 'slight rain', 63: 'moderate rain', 65: 'heavy rain',
  71: 'slight snow', 73: 'moderate snow', 75: 'heavy snow',
  80: 'rain showers', 95: 'thunderstorm',
};

const DEFAULT_LOCATION = 'London';

// Words that can sit next to a location trigger but aren't place names —
// guards against false matches like "to euros", "this weekend", "the weather",
// and (the bug this list used to miss) verbs like "want to visit" grabbing
// "visit" as if it were a place.
const LOCATION_STOPWORDS = new Set([
  'the', 'this', 'that', 'a', 'an', 'weekend', 'week', 'today', 'tomorrow',
  'now', 'advice', 'office', 'town', 'city', 'area', 'weather', 'check',
  'current', 'todays', 'get', 'whats', 'hows', 'like', 'report', 'forecast',
  'update', 'please', 'there',
  'euros', 'euro', 'dollars', 'dollar', 'rupees', 'rupee', 'pounds', 'pound', 'yen',
  'usd', 'eur', 'gbp', 'jpy', 'inr', 'convert', 'converts', 'converting',
  'visit', 'visiting', 'go', 'going', 'travel', 'traveling', 'travelling',
  'see', 'seeing', 'explore', 'exploring', 'stay', 'staying', 'live', 'living',
  'move', 'moving', 'fly', 'flying', 'head', 'heading', 'come', 'coming',
  'return', 'returning', 'book', 'booking', 'plan', 'planning',
]);

function isRealLocation(candidate: string): boolean {
  return !LOCATION_STOPWORDS.has(candidate.toLowerCase());
}

/**
 * Naive location extraction, tried in order:
 * 1. word following in/at/for/to/about/near, first non-stopword hit
 *    scanning left to right ("weather in Berlin", "research about Berlin")
 * 2. word immediately before "weather" ("Berlin weather")
 * 3. word immediately after "weather" ("weather Berlin")
 * else the default location.
 *
 * Uses matchAll (not the first regex hit) because a task can contain more
 * than one preposition+word pair — e.g. "research about berlin, ... i want
 * to visit there" matches both "about berlin" and "to visit"; stopping at
 * whichever appears first in the sentence used to pick "visit" when it came
 * before "about berlin", silently sending the wrong city to the weather API.
 */
export function extractLocation(task: string): string {
  const prepositionMatches = task.matchAll(/\b(?:in|at|for|to|about|near)\s+([a-zA-Z]+)/gi);
  for (const match of prepositionMatches) {
    if (isRealLocation(match[1])) {
      return match[1].trim();
    }
  }

  const beforeWeatherMatch = task.match(/\b([a-zA-Z]+)\s+weather\b/i);
  if (beforeWeatherMatch && isRealLocation(beforeWeatherMatch[1])) {
    return beforeWeatherMatch[1].trim();
  }

  const afterWeatherMatch = task.match(/\bweather\s+([a-zA-Z]+)\b/i);
  if (afterWeatherMatch && isRealLocation(afterWeatherMatch[1])) {
    return afterWeatherMatch[1].trim();
  }

  return DEFAULT_LOCATION;
}

export interface WeatherOutput {
  agent: 'weather';
  location: string;
  resolvedName: string;
  temperatureCelsius: number;
  windSpeedKmh: number;
  condition: string;
  live: boolean;
  note?: string;
  generatedAt: string;
}

/** Pure work function — reused by /work, /redeem, and /debug/preview. */
export async function runWeather(task: string): Promise<WeatherOutput> {
  const location = extractLocation(task);
  const looked = await lookupWeather(location);
  return { agent: 'weather', location, generatedAt: new Date().toISOString(), ...looked };
}

/**
 * POST /work
 * Only called after x402 payment is verified by the middleware.
 */
export async function handleWeatherWork(c: Context) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const task: string = typeof body?.task === 'string' ? body.task : '';

    console.log('✓ PAYMENT VERIFIED — POST /work (weather) executing (deterministic, no LLM)');

    return c.json(await runWeather(task));
  } catch (error) {
    console.error('Error in weather work handler:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

// Fallback only — used when Open-Meteo is unreachable (the same class of
// outage already hit formatter's FX API during this project). A flaky
// external API shouldn't take the whole agent down on stage; output is
// clearly marked `live: false` rather than passing off stale numbers as
// current.
const FALLBACK_WEATHER: Record<string, { resolvedName: string; temperatureCelsius: number; windSpeedKmh: number; condition: string }> = {
  london: { resolvedName: 'London, United Kingdom', temperatureCelsius: 15, windSpeedKmh: 12, condition: 'partly cloudy' },
  berlin: { resolvedName: 'Berlin, Germany', temperatureCelsius: 14, windSpeedKmh: 10, condition: 'overcast' },
  'new york': { resolvedName: 'New York, United States', temperatureCelsius: 18, windSpeedKmh: 14, condition: 'clear sky' },
  delhi: { resolvedName: 'Delhi, India', temperatureCelsius: 30, windSpeedKmh: 8, condition: 'clear sky' },
  tokyo: { resolvedName: 'Tokyo, Japan', temperatureCelsius: 20, windSpeedKmh: 9, condition: 'partly cloudy' },
};

async function lookupWeather(
  location: string
): Promise<{
  resolvedName: string;
  temperatureCelsius: number;
  windSpeedKmh: number;
  condition: string;
  live: boolean;
  note?: string;
}> {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!geoRes.ok) throw new Error(`Geocoding request failed: ${geoRes.status}`);
    const geo = (await geoRes.json()) as any;
    const place = geo.results?.[0];
    if (!place) throw new Error(`Could not find a location matching "${location}"`);

    const forecastRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current_weather=true`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!forecastRes.ok) throw new Error(`Forecast request failed: ${forecastRes.status}`);
    const forecast = (await forecastRes.json()) as any;
    const current = forecast.current_weather;

    return {
      resolvedName: `${place.name}, ${place.country}`,
      temperatureCelsius: current.temperature,
      windSpeedKmh: current.windspeed,
      condition: WEATHER_CODES[current.weathercode] ?? `weather code ${current.weathercode}`,
      live: true,
    };
  } catch (err) {
    console.error(`⚠ live weather API unreachable, using fallback: ${(err as Error).message}`);
    const fallback = FALLBACK_WEATHER[location.toLowerCase()] ?? {
      resolvedName: location,
      temperatureCelsius: 20,
      windSpeedKmh: 10,
      condition: 'unknown (fallback)',
    };
    return {
      ...fallback,
      live: false,
      note: 'Live weather API unreachable — using an approximate fallback, not the current conditions.',
    };
  }
}
