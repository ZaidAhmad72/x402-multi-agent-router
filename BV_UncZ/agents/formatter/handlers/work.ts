import type { Context } from 'hono';

// Deterministic only — no LLM call anywhere in this file. This is a hard
// requirement (see CLAUDE.md §4): the formatter must be the one agent whose
// output is fully reproducible from its input, every time.

interface LineStat {
  label: string;
  length: number;
}

export interface FormatterOutput {
  agent: 'formatter';
  deterministic: true;
  stats: LineStat[];
  svg: string;
  generatedAt: string;
}

/** Pure work function — reused by both the payment-gated /work route and /redeem. */
export function runFormatter(text: string): FormatterOutput {
  const stats = computeLineStats(text);
  return {
    agent: 'formatter',
    deterministic: true,
    stats,
    svg: renderBarChart(stats),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * POST /work
 * Only called after x402 payment is verified by the middleware.
 * Input: { text: string } (e.g. the writer agent's summary body)
 * Output: a deterministic SVG bar chart of per-line character counts.
 */
export async function handleFormatterWork(c: Context) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const text: string = typeof body?.text === 'string' ? body.text : '';

    console.log('✓ PAYMENT VERIFIED — POST /work (formatter) executing (deterministic, no LLM)');

    return c.json(runFormatter(text));
  } catch (error) {
    console.error('Error in formatter work handler:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

function computeLineStats(text: string): LineStat[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return [{ label: 'line 1', length: text.length }];
  }
  return lines.map((line, i) => ({ label: `line ${i + 1}`, length: line.length }));
}

function renderBarChart(stats: LineStat[]): string {
  const barHeight = 24;
  const gap = 6;
  const chartWidth = 400;
  const labelColumnWidth = 100;
  const maxLength = Math.max(...stats.map((s) => s.length), 1);
  const width = labelColumnWidth + chartWidth + 60;
  const height = stats.length * (barHeight + gap) + gap;

  const bars = stats
    .map((s, i) => {
      const y = gap + i * (barHeight + gap);
      const barWidth = Math.round((s.length / maxLength) * chartWidth);
      return (
        `<rect x="${labelColumnWidth}" y="${y}" width="${barWidth}" height="${barHeight}" fill="#4f8ef7" />` +
        `<text x="4" y="${y + barHeight / 2 + 4}" font-size="12" font-family="monospace">${escapeXml(s.label)}</text>` +
        `<text x="${labelColumnWidth + barWidth + 4}" y="${y + barHeight / 2 + 4}" font-size="12" font-family="monospace">${s.length}</text>`
      );
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${bars}</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
