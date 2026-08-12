/**
 * Judge-triggerable self-test for the replay guard (shared/replayGuard.ts).
 * Fires N concurrent /redeem calls at one real agent, all carrying the exact
 * same X-PAYMENT-GROUP / X-PAYMENT-INDEX pair, and shows that the agent's
 * own in-memory guard lets exactly one through and rejects the rest with
 * 409 — live, against the real running agent process, not simulated.
 *
 * The groupId used doesn't need to correspond to a real settlement — this
 * test exercises the guard, which runs (and must reject duplicates) before
 * on-chain payment verification even starts. The one request that gets past
 * the guard will still correctly fail payment verification afterwards
 * (no real payment exists for a synthetic group), which is expected and a
 * separate, already-proven concern.
 */

import { AGENT_REGISTRY } from '../shared/constants';

export interface SelfTestReplayResult {
  agent: string;
  groupId: string;
  index: number;
  attempts: number;
  passedGuard: number;
  replayRejected: number;
  results: { attempt: number; status: number; body: unknown }[];
}

export async function selfTestReplay(agentName: string, n: number): Promise<SelfTestReplayResult> {
  const agent = AGENT_REGISTRY.find((a) => a.name === agentName);
  if (!agent) {
    throw new Error(`unknown agent '${agentName}'`);
  }

  const groupId = `SELFTEST-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const index = 0;

  const results = await Promise.all(
    Array.from({ length: n }, (_, attempt) =>
      fetch(`${agent.url}/redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PAYMENT-GROUP': groupId,
          'X-PAYMENT-INDEX': String(index),
        },
        body: JSON.stringify({}),
      })
        .then(async (res) => ({ attempt, status: res.status, body: await res.json().catch(() => ({})) }))
        .catch((err) => ({ attempt, status: 0, body: { error: (err as Error).message } }))
    )
  );

  const replayRejected = results.filter((r) => r.status === 409).length;
  const passedGuard = n - replayRejected;

  return { agent: agentName, groupId, index, attempts: n, passedGuard, replayRejected, results };
}
