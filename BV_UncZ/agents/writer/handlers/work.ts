import type { Context } from 'hono';

const GROQ_MODEL = 'llama-3.3-70b-versatile';

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
export async function runWriter(task: string, findings: Finding[]): Promise<WriterOutput> {
  const summary =
    process.env.MOCK === 'true' ? buildMockSummary(task, findings) : await groqSummary(task, findings);
  return {
    agent: 'writer',
    task,
    summary,
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

    return c.json(await runWriter(task, findings));
  } catch (error) {
    console.error('Error in writer work handler:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

function buildMockSummary(task: string, findings: Finding[]) {
  const bullets = findings.length > 0
    ? findings.map((f, i) => `${i + 1}. ${f.point ?? 'finding'}`).join('\n')
    : '1. No findings supplied — summary generated from task alone.';

  return {
    title: `Summary: ${task}`,
    body: `Structured summary of "${task}", based on the supplied findings:\n\n${bullets}`,
  };
}

/** Real writing: asks Groq to synthesize the research agent's findings into a short summary. */
async function groqSummary(task: string, findings: Finding[]): Promise<{ title: string; body: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set and MOCK is not true — writer agent cannot run.');
  }

  const findingsText = findings.length
    ? findings.map((f, i) => `${i + 1}. ${f.point ?? ''}`).join('\n')
    : '(no findings supplied)';

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a writer agent. Given a task and a list of research findings, produce a short, ' +
            'structured summary as JSON: {"title": string, "body": string}. The body should be 2-4 ' +
            'sentences synthesizing the findings into a coherent answer to the task. Respond with ONLY ' +
            'the JSON object.',
        },
        { role: 'user', content: `Task: ${task}\n\nFindings:\n${findingsText}` },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq writer request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as any;
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Groq writer response had no content');

  const parsed = JSON.parse(raw);
  return {
    title: typeof parsed?.title === 'string' ? parsed.title : `Summary: ${task}`,
    body: typeof parsed?.body === 'string' ? parsed.body : JSON.stringify(parsed),
  };
}
