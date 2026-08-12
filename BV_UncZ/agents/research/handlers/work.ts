import type { Context } from 'hono';

const GROQ_MODEL = 'llama-3.3-70b-versatile';

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
export async function runResearch(task: string): Promise<ResearchOutput> {
  const findings = process.env.MOCK === 'true' ? mockFindings(task) : await groqFindings(task);
  return {
    agent: 'research',
    task,
    findings,
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

    return c.json(await runResearch(task));
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

/**
 * Real research: asks Groq for sourced bullet findings as structured JSON.
 * "source" here is the LLM's own attribution of the kind of knowledge behind
 * each point (general/reasoned, not a live web citation) — labelled as such
 * rather than implying a live search, since none is performed.
 */
async function groqFindings(task: string): Promise<Finding[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set and MOCK is not true — research agent cannot run.');
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a research agent. Given a task, return 3-5 concise bullet findings as JSON: ' +
            '{"findings": [{"point": string, "source": string}]}. "source" should describe the kind ' +
            'of knowledge behind the point (e.g. "general knowledge", "domain reasoning"), not a fake URL. ' +
            'Respond with ONLY the JSON object.',
        },
        { role: 'user', content: task },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq research request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Groq research response had no content');

  const parsed = JSON.parse(raw);
  const findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
  if (findings.length === 0) throw new Error('Groq research returned no findings');

  return findings.map((f: any) => ({
    point: typeof f?.point === 'string' ? f.point : String(f),
    source: typeof f?.source === 'string' ? f.source : 'groq-llama-3.3-70b',
  }));
}
