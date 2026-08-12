/**
 * Phase 3 — redeem. Router calls each agent again with the group ID + its
 * index as proof. The agent verifies on-chain that it was paid; it does not
 * trust the router. Pipelined research -> writer -> formatter so the
 * assembled result is coherent (atomic payment is not atomic execution —
 * this ordering is a content-quality choice, not a payment guarantee).
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
): Promise<{ research?: any; writer?: any; formatter?: any }> {
  console.log('\nREDEEM — calling each selected agent with its group ID + index as proof...');

  const selected = new Set(quotes.map((q) => q.agent));
  const out: { research?: any; writer?: any; formatter?: any } = {};

  // Dynamic agent selection (selectAgents.ts) means the group may not contain
  // all three agents — only redeem, and only wire up dependencies for, the
  // ones that were actually quoted and settled.
  if (selected.has('research')) {
    const research = findAgent('research', quotes, settlement);
    out.research = await redeemOne('research', research.url, settlement.groupId, research.index, { task });
    console.log(`  ✓ research redeemed (txId=${research.txId})`);
  }

  if (selected.has('writer')) {
    const writer = findAgent('writer', quotes, settlement);
    out.writer = await redeemOne('writer', writer.url, settlement.groupId, writer.index, {
      task,
      findings: out.research?.findings ?? [],
    });
    console.log(`  ✓ writer redeemed (txId=${writer.txId})`);
  }

  if (selected.has('formatter')) {
    const formatter = findAgent('formatter', quotes, settlement);
    out.formatter = await redeemOne('formatter', formatter.url, settlement.groupId, formatter.index, {
      text: out.writer?.summary?.body ?? task,
    });
    console.log(`  ✓ formatter redeemed (txId=${formatter.txId})`);
  }

  console.log('REDEEM complete\n');

  return out;
}
