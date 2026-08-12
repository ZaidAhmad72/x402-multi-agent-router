import type { Context } from 'hono';

// Deterministic only — no LLM call anywhere in this file. This is a hard
// requirement (see CLAUDE.md §4): the formatter's output is a reproducible
// transformation of its input plus a live, keyless, non-LLM data source
// (an FX rate), not an LLM guess — it never hallucinates and always works
// on stage the same way weather/currency APIs do elsewhere in this stack.

const CURRENCY_NAMES: Record<string, string> = {
  rupee: 'INR', rupees: 'INR', inr: 'INR',
  dollar: 'USD', dollars: 'USD', usd: 'USD',
  euro: 'EUR', euros: 'EUR', eur: 'EUR',
  pound: 'GBP', pounds: 'GBP', gbp: 'GBP',
  yen: 'JPY', jpy: 'JPY',
};
const TARGET_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'INR'];
const DEFAULT_AMOUNT = 100;
const DEFAULT_FROM = 'USD';

interface ConversionRow {
  currency: string;
  amount: number;
}

export interface FormatterOutput {
  agent: 'formatter';
  deterministic: true;
  sourceAmount: number;
  sourceCurrency: string;
  conversions: ConversionRow[];
  svg: string;
  generatedAt: string;
  live: boolean;
  note?: string;
}

// Fallback only — used when the live FX API (open.er-api.com) is unreachable,
// which has been observed to happen (a real, confirmed network outage during
// testing, not hypothetical). Approximate, roughly-current rates as of this
// build; still fully deterministic and non-LLM, just not live. Output is
// clearly marked `live: false` rather than silently passing off stale
// numbers as current — a flaky external API shouldn't take the whole agent
// down on stage.
const FALLBACK_RATES_FROM_USD: Record<string, number> = {
  USD: 1, EUR: 0.865, GBP: 0.741, JPY: 159.3, INR: 87.5,
};

/** Pure work function — reused by both the payment-gated /work route and /redeem. */
export async function runFormatter(text: string): Promise<FormatterOutput> {
  const { amount, from } = parseAmountAndCurrency(text);
  const { conversions, live, note } = await fetchConversions(amount, from);

  return {
    agent: 'formatter',
    deterministic: true,
    sourceAmount: amount,
    sourceCurrency: from,
    conversions,
    svg: renderBarChart(amount, from, conversions),
    generatedAt: new Date().toISOString(),
    live,
    ...(note ? { note } : {}),
  };
}

/**
 * POST /work
 * Only called after x402 payment is verified by the middleware.
 * Input: { text: string } (e.g. the writer agent's summary body)
 * Output: a live currency conversion rendered as a deterministic SVG bar chart.
 */
export async function handleFormatterWork(c: Context) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const text: string = typeof body?.text === 'string' ? body.text : '';

    console.log('✓ PAYMENT VERIFIED — POST /work (formatter) executing (deterministic, no LLM)');

    return c.json(await runFormatter(text));
  } catch (error) {
    console.error('Error in formatter work handler:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

const CURRENCY_WORD_ALTERNATION = Object.keys(CURRENCY_NAMES).join('|');

function parseAmountAndCurrency(text: string): { amount: number; from: string } {
  const lower = text.toLowerCase();

  // Prefer a number adjacent to a currency word (e.g. "100 usd" or "usd
  // 100") over the first number anywhere in the text — text upstream of
  // formatter (e.g. a writer summary combining weather + currency) can
  // contain unrelated numbers, like a temperature, earlier in the string.
  const numberThenCurrency = lower.match(new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:${CURRENCY_WORD_ALTERNATION})\\b`));
  const currencyThenNumber = lower.match(new RegExp(`\\b(?:${CURRENCY_WORD_ALTERNATION})\\s*(\\d[\\d,]*(?:\\.\\d+)?)`));
  const anyNumber = lower.match(/(\d[\d,]*(?:\.\d+)?)/);
  const amountMatch = numberThenCurrency ?? currencyThenNumber ?? anyNumber;
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : DEFAULT_AMOUNT;

  let from = DEFAULT_FROM;
  for (const [name, code] of Object.entries(CURRENCY_NAMES)) {
    if (lower.includes(name)) {
      from = code;
      break;
    }
  }

  return { amount, from };
}

async function fetchConversions(
  amount: number,
  from: string
): Promise<{ conversions: ConversionRow[]; live: boolean; note?: string }> {
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`Exchange rate request failed: ${res.status}`);
    const data = (await res.json()) as any;
    if (data.result !== 'success') throw new Error(`Exchange rate API error: ${data.result}`);

    const conversions = TARGET_CURRENCIES.filter((c) => c !== from).map((currency) => ({
      currency,
      amount: Math.round(amount * data.rates[currency] * 100) / 100,
    }));
    return { conversions, live: true };
  } catch (err) {
    console.error(`⚠ live FX API unreachable, using fallback rates: ${(err as Error).message}`);
    const fromRateInUsd = FALLBACK_RATES_FROM_USD[from] ?? 1;
    const conversions = TARGET_CURRENCIES.filter((c) => c !== from).map((currency) => ({
      currency,
      amount: Math.round(((amount / fromRateInUsd) * (FALLBACK_RATES_FROM_USD[currency] ?? 1)) * 100) / 100,
    }));
    return {
      conversions,
      live: false,
      note: 'Live FX API unreachable — using approximate fallback rates, not current market rates.',
    };
  }
}

// NOT a bar chart, on purpose. A converted amount's bar length used to scale
// with the raw number (e.g. "250 USD" -> ~217 EUR but ~39,823 JPY), which
// visually implied JPY was worth ~180x more — backwards: every row here is
// worth exactly the same as the source amount, by definition of a currency
// conversion. Comparing raw numeric magnitude across currencies with very
// different per-unit value (JPY, INR) is comparing unit-scale artifacts, not
// value — same category error as saying "250000mm > 250m". A clean table
// avoids implying a comparison that doesn't exist.
function renderBarChart(sourceAmount: number, from: string, rows: ConversionRow[]): string {
  const rowHeight = 28;
  const width = 300;
  const height = rows.length * rowHeight + 44;
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

  const rows_ = rows
    .map((r, i) => {
      const y = 40 + i * rowHeight;
      return (
        `<rect x="0" y="${y - 16}" width="4" height="20" fill="#4f8ef7" />` +
        `<text x="14" y="${y}" font-size="13" font-family="monospace" font-weight="bold">${r.currency}</text>` +
        `<text x="70" y="${y}" font-size="13" font-family="monospace">${fmt(r.amount)}</text>`
      );
    })
    .join('');

  const title = `<text x="0" y="16" font-size="13" font-family="monospace" font-weight="bold">${fmt(sourceAmount)} ${from} equals:</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g transform="translate(8,8)">${title}${rows_}</g></svg>`;
}
