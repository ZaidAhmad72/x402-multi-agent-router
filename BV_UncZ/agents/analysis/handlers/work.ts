import type { Context } from 'hono';

const GROQ_MODEL = 'llama-3.3-70b-versatile';

export interface WeatherContext {
  resolvedName?: string;
  condition?: string;
  temperatureCelsius?: number;
  windSpeedKmh?: number;
}

export interface CurrencyContext {
  sourceAmount?: number;
  sourceCurrency?: string;
  conversions?: { currency: string; amount: number }[];
}

export interface AnalysisOutput {
  agent: 'analysis';
  task: string;
  text: string;
  generatedAt: string;
}

/** Pure work function — reused by /work, /redeem, and /debug/preview. */
export async function runAnalysis(
  task: string,
  weather?: WeatherContext,
  currency?: CurrencyContext
): Promise<AnalysisOutput> {
  const text =
    process.env.MOCK === 'true' ? buildMockAnalysis(task, weather, currency) : await groqAnalysis(task, weather, currency);
  return { agent: 'analysis', task, text, generatedAt: new Date().toISOString() };
}

/**
 * POST /work
 * Only called after x402 payment is verified by the middleware.
 */
export async function handleAnalysisWork(c: Context) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const task = typeof body?.task === 'string' && body.task.trim() ? body.task.trim() : 'unspecified task';
    const weather: WeatherContext | undefined = body?.weather ?? undefined;
    const currency: CurrencyContext | undefined = body?.currency ?? undefined;

    console.log('✓ PAYMENT VERIFIED — POST /work (analysis) executing');

    return c.json(await runAnalysis(task, weather, currency));
  } catch (error) {
    console.error('Error in analysis work handler:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

function buildContextLines(weather?: WeatherContext, currency?: CurrencyContext): string[] {
  const lines: string[] = [];
  if (weather?.resolvedName) {
    lines.push(
      `Weather in ${weather.resolvedName}: ${weather.condition}, ${weather.temperatureCelsius}°C, wind ${weather.windSpeedKmh} km/h.`
    );
  }
  if (currency?.conversions?.length) {
    const rows = currency.conversions.map((c) => `${c.amount} ${c.currency}`).join(', ');
    lines.push(`Currency: ${currency.sourceAmount} ${currency.sourceCurrency} converts to ${rows}.`);
  }
  return lines;
}

function buildMockAnalysis(task: string, weather?: WeatherContext, currency?: CurrencyContext): string {
  const lines = buildContextLines(weather, currency);
  return lines.length
    ? `Based on the task "${task}": ${lines.join(' ')}`
    : `No weather or currency data was supplied for "${task}" — analysis generated from the task alone.`;
}

/** Real synthesis: asks Groq to tie whatever weather/currency data exists into a short narrative. */
async function groqAnalysis(task: string, weather?: WeatherContext, currency?: CurrencyContext): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set and MOCK is not true — analysis agent cannot run.');
  }

  const contextLines = buildContextLines(weather, currency);
  const userContent = contextLines.length ? `${task}\n\nRelevant data gathered so far:\n${contextLines.join('\n')}` : task;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a concise assistant that synthesizes any provided weather/currency data with the ' +
            "user's question into a short, direct answer. Keep it to 2-4 sentences.",
        },
        { role: 'user', content: userContent },
      ],
      temperature: 0.5,
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq analysis request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq analysis response had no content');
  return text;
}
