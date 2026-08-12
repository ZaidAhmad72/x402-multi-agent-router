/**
 * Phase 2a — quote phase.
 *
 * Fan out the payment challenges: call every agent with NO payment header,
 * decode each 402's PaymentRequirements, and sum into a total. An agent that
 * is down or doesn't challenge throws here, before any money moves — this is
 * the liveness guarantee.
 */

import { decodePaymentRequiredHeader } from '@x402/core/http';
import { AGENT_REGISTRY, type AgentRegistryEntry } from '../shared/constants';
import type { AgentQuote, QuotePhaseResult } from '../shared/types';

export class LivenessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LivenessError';
  }
}

async function quoteOne(agent: AgentRegistryEntry): Promise<AgentQuote> {
  const url = `${agent.url}/work`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch (err) {
    throw new Error(`${agent.name} unreachable at ${url}: ${(err as Error).message}`);
  }

  if (response.status !== 402) {
    throw new Error(
      `${agent.name} did not challenge with 402 (got ${response.status}) — agent is not enforcing payment`
    );
  }

  const header = response.headers.get('payment-required');
  if (!header) {
    throw new Error(`${agent.name} returned 402 with no payment-required header`);
  }

  const decoded = decodePaymentRequiredHeader(header);
  const accept = decoded.accepts[0];
  if (!accept) {
    throw new Error(`${agent.name} returned 402 with no payment requirements in accepts[]`);
  }

  console.log(
    `  ✓ 402 from ${agent.name.padEnd(10)} payTo=${accept.payTo}  amount=${accept.amount} microUSDC  asset=${accept.asset}`
  );

  return {
    agent: agent.name,
    url: agent.url,
    scheme: accept.scheme,
    network: accept.network,
    asset: accept.asset,
    amountMicroUsdc: accept.amount,
    payTo: accept.payTo,
    description: decoded.resource?.description ?? '',
  };
}

export async function quoteAgents(
  registry: AgentRegistryEntry[] = AGENT_REGISTRY
): Promise<QuotePhaseResult> {
  console.log(`\nQUOTE — challenging ${registry.length} agents in parallel (no payment header)...`);

  const results = await Promise.allSettled(registry.map(quoteOne));

  const quotes: AgentQuote[] = [];
  const failures: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      quotes.push(r.value);
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      failures.push(`${registry[i].name}: ${reason}`);
    }
  });

  if (failures.length > 0) {
    throw new LivenessError(
      `Liveness check failed before any money moved — ${failures.length} agent(s) did not challenge: ${failures.join('; ')}`
    );
  }

  const totalMicroUsdc = quotes.reduce((sum, q) => sum + Number(q.amountMicroUsdc), 0);
  const totalUsd = totalMicroUsdc / 1_000_000;

  console.log(
    `QUOTE complete — total $${totalUsd.toFixed(2)} (${totalMicroUsdc} microUSDC) across ${quotes.length} agents\n`
  );

  return { quotes, totalMicroUsdc, totalUsd };
}
