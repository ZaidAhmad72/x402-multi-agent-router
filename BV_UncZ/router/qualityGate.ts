/**
 * Pre-settlement quality gate — the "atomic payment is not atomic execution"
 * gap (CLAUDE.md §8) partially closed. Before any quoting, signing, or
 * spending happens, every selected agent is trial-run for free via its own
 * /debug/preview route (same call debugPreview.ts uses), and a Groq judge
 * scores whether each trial output is actually a substantive, relevant
 * answer to the task.
 *
 * This is what makes stake+slash (router/stake.ts, router/settle.ts)
 * possible without inverting the x402 "pay then get work" order: quality is
 * checked against a free trial run *before* payment, so by the time SETTLE
 * builds the atomic group it already knows, per agent, whether to pay
 * normally or slash. index.ts decides what to do with a failing verdict —
 * an agent with a configured stake gets slashed in settle.ts; an unstaked
 * agent failing still aborts the whole route with zero spend, same as
 * before this feature existed.
 *
 * Fails open on any Groq error (same policy as selectAgents.ts) — an LLM
 * outage should never block the whole route, only skip the extra check.
 *
 * `forceMode` is a demo/testing lever (mirrors the agent kill switch): set
 * via POST /admin/quality-gate/:mode so specific test cases ("bad answer ->
 * no payment" or "bad answer -> slash") are reproducible without depending
 * on a live judge call agreeing to reject on demand.
 */

import type { AgentRegistryEntry } from '../shared/constants';
import { getStakeConfig } from './stake';
import { previewOne } from './previewCall';

const GROQ_MODEL = 'llama-3.3-70b-versatile';

export interface QualityVerdict {
  agent: string;
  ok: boolean;
  reason: string;
  /** Whether this agent has a stake wallet configured — determines whether a failure slashes or aborts. */
  staked: boolean;
}

export type QualityGateMode = 'auto' | 'pass' | 'fail';
let forceMode: QualityGateMode = 'auto';
// Targeted override, independent of forceMode: forces exactly one named
// agent to fail while every other agent still runs the real trial+judge (or
// forced pass/fail, if forceMode is also set). Lets a demo isolate "only
// the staked agent's output is bad" -> slash, without also forcing
// research/writer to fail (which would abort the whole route, since they
// have no stake to fall back on). Cleared automatically by setQualityGateMode.
let forcedFailAgent: string | null = null;

export function setQualityGateMode(mode: QualityGateMode): void {
  forceMode = mode;
  forcedFailAgent = null;
}

export function getQualityGateMode(): QualityGateMode {
  return forceMode;
}

export function setForcedFailAgent(agent: string | null): void {
  forcedFailAgent = agent;
}

export function getForcedFailAgent(): string | null {
  return forcedFailAgent;
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
 * Never throws — returns one verdict per agent; the caller decides what a
 * failing verdict means (abort vs slash) based on `staked`.
 */
export async function runQualityGate(task: string, registry: AgentRegistryEntry[]): Promise<QualityVerdict[]> {
  const verdicts: QualityVerdict[] = [];
  const outputs: Record<string, any> = {};

  console.log(`\nQUALITY GATE — checking ${registry.length} agent(s) before any money moves (mode: ${forceMode})...`);

  for (const entry of registry) {
    const staked = getStakeConfig(entry.name) !== null;

    if (forceMode === 'pass') {
      verdicts.push({ agent: entry.name, ok: true, reason: 'forced pass (demo override)', staked });
      console.log(`  ✓ ${entry.name}: forced pass${staked ? ' [staked]' : ''}`);
      continue;
    }
    if (forceMode === 'fail') {
      verdicts.push({ agent: entry.name, ok: false, reason: 'forced fail (demo override)', staked });
      console.log(`  ✗ ${entry.name}: forced fail${staked ? ' [staked -> will be slashed]' : ' [unstaked -> will abort]'}`);
      continue;
    }
    if (forcedFailAgent === entry.name) {
      verdicts.push({ agent: entry.name, ok: false, reason: 'forced fail (targeted demo override)', staked });
      console.log(`  ✗ ${entry.name}: forced fail (targeted)${staked ? ' [staked -> will be slashed]' : ' [unstaked -> will abort]'}`);
      continue;
    }

    let output: any;
    try {
      output = await previewOne(entry.url, entry.buildInput(task, outputs));
    } catch (err) {
      const reason = `trial run failed: ${(err as Error).message}`;
      verdicts.push({ agent: entry.name, ok: false, reason, staked });
      console.log(`  ✗ ${entry.name}: ${reason}`);
      continue;
    }
    outputs[entry.name] = output;

    const verdict = await judgeOne(entry.name, task, output);
    verdicts.push({ agent: entry.name, ok: verdict.ok, reason: verdict.reason, staked });
    console.log(`  ${verdict.ok ? '✓' : '✗'} ${entry.name}: ${verdict.reason}${staked ? ' [staked]' : ''}`);
  }

  return verdicts;
}
