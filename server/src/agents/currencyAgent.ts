const CURRENCY_NAMES: Record<string, string> = {
  rupee: "INR",
  rupees: "INR",
  inr: "INR",
  dollar: "USD",
  dollars: "USD",
  usd: "USD",
  euro: "EUR",
  euros: "EUR",
  eur: "EUR",
  pound: "GBP",
  pounds: "GBP",
  gbp: "GBP",
  yen: "JPY",
  jpy: "JPY",
};

const DEFAULT_FROM = "USD";
const DEFAULT_TO = "EUR";
const DEFAULT_AMOUNT = 1;

interface ParsedConversion {
  amount: number;
  from: string;
  to: string;
}

/** Naive parse of "<amount> <currency> to <currency>" style phrases, with sane defaults. */
export function parseConversion(task: string): ParsedConversion {
  const text = task.toLowerCase();

  const amountMatch = text.match(/(\d[\d,]*(?:\.\d+)?)/);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : DEFAULT_AMOUNT;

  const currenciesFound: string[] = [];
  for (const [name, code] of Object.entries(CURRENCY_NAMES)) {
    if (text.includes(name) && !currenciesFound.includes(code)) {
      currenciesFound.push(code);
    }
  }

  return {
    amount,
    from: currenciesFound[0] ?? DEFAULT_FROM,
    to: currenciesFound[1] ?? DEFAULT_TO,
  };
}

export interface CurrencyResult {
  agent: "currency";
  amount: number;
  from: string;
  to: string;
  rate: number;
  converted: number;
}

export async function runCurrencyAgent(
  task: string,
  extractedAmount?: number | null,
  extractedFrom?: string | null,
  extractedTo?: string | null
): Promise<CurrencyResult> {
  const parsed = parseConversion(task);
  const amount = extractedAmount ?? parsed.amount;
  const from = extractedFrom ?? parsed.from;
  const to = extractedTo ?? parsed.to;

  const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
  if (!res.ok) throw new Error(`Exchange rate request failed: ${res.status}`);
  const data = (await res.json()) as any;
  if (data.result !== "success") throw new Error(`Exchange rate API error: ${data.result}`);

  const rate = data.rates[to];
  if (rate === undefined) throw new Error(`No rate available for ${from} -> ${to}`);

  return {
    agent: "currency",
    amount,
    from,
    to,
    rate,
    converted: Math.round(amount * rate * 100) / 100,
  };
}
