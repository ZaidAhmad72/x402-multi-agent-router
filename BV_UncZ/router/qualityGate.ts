/**
 * Pre-settlement quality gate — the "atomic payment is not atomic execution"
 * gap (CLAUDE.md §8) partially closed. Before any quoting, signing, or
 * spending happens, every selected agent is trial-run for free via its own
 * /debug/preview route (same call debugPreview.ts uses), and a Groq judge
 * scores whether each trial output is actually a substantive, relevant
 * answer to the task. If any agent's trial output fails, the whole route
 * aborts here — zero spend, before QUOTE even runs.
 *
 * This does not replace the liveness/budget/group-size gates in
 * quote.ts/settle.ts; it runs before all of them, and only checks output
 * *quality*, not payment mechanics.
 *
 * Fails open on any Groq error (same policy as selectAgents.ts) — an LLM
 * outage should never block the whole route, only skip the extra check.
 *
 * `forceMode` is a demo/testing lever (mirrors the agent kill switch): set
 * via POST /admin/quality-gate/:mode so specific test cases ("bad answer ->
 * no payment") are reproducible without depending on a live judge call
 * agreeing to reject on demand.
 */

import type { AgentRegistryEntry } from '../shared/constants';
import { previewOne } from './previewCall';

const GROQ_MODEL = 'llama-3.3-70b-versatile';

export class QualityGateError extends Error {
  failures: { agent: string; reason: string }[];
  constructor(failures: { agent: string; reason: string }[]) {
    super(
      `Quality gate rejected ${failures.length} agent output(s) before any payment: ` +
        failures.map((f) => `${f.agent} (${f.reason})`).join('; ')
    );
    this.name = 'QualityGateError';
    this.failures = failures;
  }
}

export type QualityGateMode = 'auto' | 'pass' | 'fail';
let forceMode: QualityGateMode = 'auto';

export function setQualityGateMode(mode: QualityGateMode): void {
  forceMode = mode;
}

export function getQualityGateMode(): QualityGateMode {
  return forceMode;
}

async function judgeOne(agentName: string, task: string, output: unknown): Promise<{ ok: boolean; reason: string }> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ok: true, reason: 'GROQ_API_KEY not set — judge skipped (fail-open)' };

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content:
              `You are a strict quality gate for an AI agent named "${agentName}". Given the user's ` +
              'task and that agent\'s produced output, decide whether the output is genuinely relevant, ' +
              'substantive, and non-empty for the task — not whether it is perfect. Respond with ONLY ' +
              'JSON: {"ok": boolean, "reason": string (max 15 words)}.',
          },
          { role: 'user', content: `Task: ${task}\n\nAgent output:\n${JSON.stringify(output).slice(0, 2000)}` },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) return { ok: true, reason: `Groq judge request failed (${res.status}) — fail-open` };

    const data = (await res.json()) as any;
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return { ok: true, reason: 'Groq judge returned no content — fail-open' };

    const parsed = JSON.parse(raw);
    return {
      ok: parsed?.ok !== false,
      reason: typeof parsed?.reason === 'string' ? parsed.reason : parsed?.ok === false ? 'rejected' : 'ok',
    };
  } catch (err) {
    return { ok: true, reason: `Groq judge error — fail-open (${(err as Error).message})` };
  }
}

/**
 * Trial-runs `registry` (in order, wiring dependencies same as redeem.ts)
 * against each agent's free /debug/preview route, then judges each output.
 * Throws QualityGateError with every failing agent if any output fails.
 */
export async function runQualityGate(task: string, registry: AgentRegistryEntry[]): Promise<void> {
  if (forceMode === 'pass') {
    console.log('QUALITY GATE — forced PASS (demo override), skipping real judge\n');
    return;
  }
  if (forceMode === 'fail') {
    console.log('QUALITY GATE — forced FAIL (demo override)\n');
    throw new QualityGateError(registry.map((a) => ({ agent: a.name, reason: 'forced fail (demo override)' })));
  }

  console.log(`\nQUALITY GATE — trial-running ${registry.length} agent(s) via /debug/preview before any money moves...`);

  const outputs: Record<string, any> = {};
  const failures: { agent: string; reason: string }[] = [];

  for (const entry of registry) {
    let output: any;
    try {
      output = await previewOne(entry.url, entry.buildInput(task, outputs));
    } catch (err) {
      const reason = `trial run failed: ${(err as Error).message}`;
      console.log(`  ✗ ${entry.name}: ${reason}`);
      failures.push({ agent: entry.name, reason });
      continue;
    }
    outputs[entry.name] = output;

    const verdict = await judgeOne(entry.name, task, output);
    console.log(`  ${verdict.ok ? '✓' : '✗'} ${entry.name}: ${verdict.reason}`);
    if (!verdict.ok) failures.push({ agent: entry.name, reason: verdict.reason });
  }

  if (failures.length > 0) throw new QualityGateError(failures);
  console.log('QUALITY GATE passed — proceeding to QUOTE\n');
}
