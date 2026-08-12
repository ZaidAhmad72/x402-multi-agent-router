import type { Context } from 'hono';

// No LLM key is wired up yet, so this always runs the canned path.
// The x402 payment path above this handler is always real — never mock the payment.
export interface Finding {
  point?: string;
  source?: string;
}

export interface WriterOutput {
  agent: 'writer';
  task: string;
  summary: { title: string; body: string };
  generatedAt: string;
}

/** Pure work function — reused by both the payment-gated /work route and /redeem. */
export function runWriter(task: string, findings: Finding[]): WriterOutput {
  return {
    agent: 'writer',
    task,
    summary: buildSummary(task, findings),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * POST /work
 * Only called after x402 payment is verified by the middleware.
 */
export async function handleWriterWork(c: Context) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const task = typeof body?.task === 'string' && body.task.trim() ? body.task.trim() : 'unspecified task';
    const findings: Finding[] = Array.isArray(body?.findings) ? body.findings : [];

    console.log('✓ PAYMENT VERIFIED — POST /work (writer) executing');

    return c.json(runWriter(task, findings));
  } catch (error) {
    console.error('Error in writer work handler:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

function buildSummary(task: string, findings: Finding[]) {
  const bullets = findings.length > 0
    ? findings.map((f, i) => `${i + 1}. ${f.point ?? 'finding'}`).join('\n')
    : '1. No findings supplied — summary generated from task alone.';

  return {
    title: `Summary: ${task}`,
    body: `Structured summary of "${task}", based on the supplied findings:\n\n${bullets}`,
  };
}
