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
}

/** Pure work function — reused by both the payment-gated /work route and /redeem. */
export async function runFormatter(text: string): Promise<FormatterOutput> {
  const { amount, from } = parseAmountAndCurrency(text);
  const conversions = await fetchConversions(amount, from);

  return {
    agent: 'formatter',
    deterministic: true,
    sourceAmount: amount,
    sourceCurrency: from,
    conversions,
    svg: renderBarChart(amount, from, conversions),
    generatedAt: new Date().toISOString(),
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

function parseAmountAndCurrency(text: string): { amount: number; from: string } {
  const lower = text.toLowerCase();

  const amountMatch = lower.match(/(\d[\d,]*(?:\.\d+)?)/);
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

async function fetchConversions(amount: number, from: string): Promise<ConversionRow[]> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
  if (!res.ok) throw new Error(`Exchange rate request failed: ${res.status}`);
  const data = (await res.json()) as any;
  if (data.result !== 'success') throw new Error(`Exchange rate API error: ${data.result}`);

  return TARGET_CURRENCIES.filter((c) => c !== from).map((currency) => ({
    currency,
    amount: Math.round(amount * data.rates[currency] * 100) / 100,
  }));
}

function renderBarChart(sourceAmount: number, from: string, rows: ConversionRow[]): string {
  const barHeight = 24;
  const gap = 8;
  const chartWidth = 320;
  const labelColumnWidth = 60;
  const maxAmount = Math.max(...rows.map((r) => r.amount), 1);
  const width = labelColumnWidth + chartWidth + 90;
  const height = rows.length * (barHeight + gap) + gap + 24;

  const bars = rows
    .map((r, i) => {
      const y = 24 + gap + i * (barHeight + gap);
      const barWidth = Math.round((r.amount / maxAmount) * chartWidth);
      return (
        `<rect x="${labelColumnWidth}" y="${y}" width="${barWidth}" height="${barHeight}" fill="#4f8ef7" />` +
        `<text x="4" y="${y + barHeight / 2 + 4}" font-size="12" font-family="monospace">${r.currency}</text>` +
        `<text x="${labelColumnWidth + barWidth + 4}" y="${y + barHeight / 2 + 4}" font-size="12" font-family="monospace">${r.amount}</text>`
      );
    })
    .join('');

  const title = `<text x="4" y="16" font-size="13" font-family="monospace" font-weight="bold">${sourceAmount} ${from} converts to:</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${title}${bars}</svg>`;
}
