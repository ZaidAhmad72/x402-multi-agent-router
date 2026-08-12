import type { Context } from 'hono';

// No LLM key is wired up yet, so this always runs the canned path.
// The x402 payment path above this handler is always real — never mock the payment.
export interface Finding {
  point: string;
  source: string;
}

export interface ResearchOutput {
  agent: 'research';
  task: string;
  findings: Finding[];
  generatedAt: string;
}

/** Pure work function — reused by both the payment-gated /work route and /redeem. */
export function runResearch(task: string): ResearchOutput {
  return {
    agent: 'research',
    task,
    findings: mockFindings(task),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * POST /work
 * Only called after x402 payment is verified by the middleware.
 */
export async function handleResearchWork(c: Context) {
  try {
    const body = await c.req.json().catch(() => ({}));
    const task = typeof body?.task === 'string' && body.task.trim() ? body.task.trim() : 'unspecified task';

    console.log('✓ PAYMENT VERIFIED — POST /work (research) executing');

    return c.json(runResearch(task));
  } catch (error) {
    console.error('Error in research work handler:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

function mockFindings(task: string): Finding[] {
  return [
    { point: `Baseline definition and scope of "${task}"`, source: 'internal-knowledge-base' },
    { point: `Leading approaches and prior art relevant to "${task}"`, source: 'internal-knowledge-base' },
    { point: `Known constraints and open questions around "${task}"`, source: 'internal-knowledge-base' },
  ];
}
