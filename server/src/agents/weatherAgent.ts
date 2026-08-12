const WEATHER_CODES: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  61: "slight rain",
  63: "moderate rain",
  65: "heavy rain",
  71: "slight snow",
  73: "moderate snow",
  75: "heavy snow",
  80: "rain showers",
  95: "thunderstorm",
};

const DEFAULT_LOCATION = "London";

// Words that can sit next to a location trigger but aren't place names —
// guards against false matches like "to euros", "this weekend", "the weather".
const LOCATION_STOPWORDS = new Set([
  "the", "this", "that", "a", "an", "weekend", "week", "today", "tomorrow",
  "now", "advice", "office", "town", "city", "area", "weather", "check",
  "current", "todays", "get", "whats", "hows", "like", "report", "forecast",
  "update", "please", "there",
  "euros", "euro", "dollars", "dollar", "rupees", "rupee", "pounds", "pound", "yen",
]);

function isRealLocation(candidate: string): boolean {
  return !LOCATION_STOPWORDS.has(candidate.toLowerCase());
}

/**
 * Naive location extraction, tried in order:
 * 1. word following in/at/for/to ("weather in Berlin")
 * 2. word immediately before "weather" ("Berlin weather")
 * 3. word immediately after "weather" ("weather Berlin")
 * else the default location.
 */
export function extractLocation(task: string): string {
  const prepositionMatch = task.match(/\b(?:in|at|for|to)\s+([a-zA-Z]+)/i);
  if (prepositionMatch && isRealLocation(prepositionMatch[1])) {
    return prepositionMatch[1].trim();
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

export interface WeatherResult {
  agent: "weather";
  location: string;
  resolvedName: string;
  temperatureCelsius: number;
  windSpeedKmh: number;
  condition: string;
}

export async function runWeatherAgent(task: string, extractedLocation?: string | null): Promise<WeatherResult> {
  const location = extractedLocation || extractLocation(task);

  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`
  );
  if (!geoRes.ok) throw new Error(`Geocoding request failed: ${geoRes.status}`);
  const geo = (await geoRes.json()) as any;
  const place = geo.results?.[0];
  if (!place) throw new Error(`Could not find a location matching "${location}"`);

  const forecastRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current_weather=true`
  );
  if (!forecastRes.ok) throw new Error(`Forecast request failed: ${forecastRes.status}`);
  const forecast = (await forecastRes.json()) as any;
  const current = forecast.current_weather;

  return {
    agent: "weather",
    location,
    resolvedName: `${place.name}, ${place.country}`,
    temperatureCelsius: current.temperature,
    windSpeedKmh: current.windspeed,
    condition: WEATHER_CODES[current.weathercode] ?? `weather code ${current.weathercode}`,
  };
}
