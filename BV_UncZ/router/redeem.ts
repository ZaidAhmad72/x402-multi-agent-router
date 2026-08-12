/**
 * Phase 3 — redeem. Router calls each agent again with the group ID + its
 * index as proof. The agent verifies on-chain that it was paid; it does not
 * trust the router. Pipelined in registry/dependency order (see
 * shared/constants.ts's buildInput) so the assembled result is coherent
 * (atomic payment is not atomic execution — this ordering is a
 * content-quality choice, not a payment guarantee). Registry-driven: adding
 * an agent to AGENT_REGISTRY is picked up here automatically.
 */

import { AGENT_REGISTRY } from '../shared/constants';
import type { AgentQuote } from '../shared/types';
import type { SettlementResult } from './settle';

export class RedeemError extends Error {
  constructor(agent: string, message: string) {
    super(`${agent} redeem failed: ${message}`);
    this.name = 'RedeemError';
  }
}

async function redeemOne(agentName: string, url: string, groupId: string, index: number, body: unknown) {
  const res = await fetch(`${url}/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT-GROUP': groupId,
      'X-PAYMENT-INDEX': String(index),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new RedeemError(agentName, json?.error ?? `HTTP ${res.status}`);
  }
  return json;
}

function findAgent(name: string, quotes: AgentQuote[], settlement: SettlementResult) {
  const quote = quotes.find((q) => q.agent === name);
  const settled = settlement.perAgent.find((p) => p.agent === name);
  const registry = AGENT_REGISTRY.find((a) => a.name === name);
  if (!quote || !settled || !registry) {
    throw new RedeemError(name, 'missing quote/settlement/registry entry — should never happen');
  }
  return { url: registry.url, index: settled.index, txId: settled.txId };
}

export async function redeemAll(
  task: string,
  quotes: AgentQuote[],
  settlement: SettlementResult
): Promise<Record<string, any>> {
  console.log('\nREDEEM — calling each selected agent with its group ID + index as proof...');

  const selected = new Set(quotes.map((q) => q.agent));
  const outputs: Record<string, any> = {};

  // Dynamic agent selection (selectAgents.ts) means the group may not contain
  // every registered agent — walk AGENT_REGISTRY in order (registry order is
  // dependency order by convention) and redeem only what was actually quoted
  // and settled, building each agent's input from prior agents' outputs via
  // its own buildInput.
  for (const entry of AGENT_REGISTRY) {
    if (!selected.has(entry.name)) continue;
    const target = findAgent(entry.name, quotes, settlement);
    outputs[entry.name] = await redeemOne(
      entry.name,
      target.url,
      settlement.groupId,
      target.index,
      entry.buildInput(task, outputs)
    );
    console.log(`  ✓ ${entry.name} redeemed (txId=${target.txId})`);
  }

  console.log('REDEEM complete\n');

  return outputs;
}
