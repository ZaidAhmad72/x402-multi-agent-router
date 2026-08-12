// Re-exported from @x402/avm so this stays the single source of truth
// (see reference/x402-starter/x402-demo-server/endpoints.config.ts)
export { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID } from '@x402/avm';

export const FACILITATOR_URL = 'https://facilitator.goplausible.xyz';
export const ALGOD_TESTNET = 'https://testnet-api.algonode.cloud';
export const INDEXER_TESTNET = 'https://testnet-idx.algonode.cloud';

// Flat per-job routing fee, charged on top of pass-through agent costs.
// Included as its own leg in the same atomic settlement group — the business
// model is a behaviour in the group, not a claim on a slide.
export const ROUTING_FEE_MICRO_USDC = 10_000n; // $0.01
export const ROUTING_FEE_USD = 0.01;

// CLAUDE.md's constant (`.../testnet/group/<id>`) 404s — Lora's real route
// includes the confirming block/round. Verified by clicking through Lora's
// own transaction -> group link rather than guessing (see docs/PROBLEMS.md).
export function explorerGroupUrl(confirmedRound: number, groupId: string): string {
  return `https://lora.algokit.io/testnet/block/${confirmedRound}/group/${encodeURIComponent(groupId)}`;
}

export interface AgentRegistryEntry {
  name: string;
  url: string;
  /** Shown to the Groq agent-selector (router/selectAgents.ts) so it knows when this agent is relevant. */
  description: string;
  /** Other agent names (by `name`) whose output this agent's buildInput reads. Auto-included when this agent is selected. */
  dependsOn?: string[];
  /** Builds the request body for this agent's /work and /redeem (and /debug/preview) calls from the task and prior agents' outputs, keyed by name. */
  buildInput: (task: string, outputs: Record<string, any>) => unknown;
}

// To add a new agent: build its service (own port/wallet/price, /work + /redeem +
// /debug/preview routes, same shape as the three below), add its wallet to
// .env.wallets, and add one entry here. quote.ts, settle.ts, redeem.ts,
// debugPreview.ts, and selectAgents.ts are all registry-driven — none of them
// need to change. (Registry is still hardcoded by design — *automatic discovery*
// of agents not listed here, e.g. via Bazaar, stays out of scope per CLAUDE.md §8.)
export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  {
    name: 'research',
    url: 'http://localhost:4001',
    description:
      'gathers sourced factual findings about a general topic. Needed for informational/explanatory tasks.',
    buildInput: (task) => ({ task }),
  },
  {
    name: 'writer',
    url: 'http://localhost:4002',
    description:
      'synthesizes research findings into a coherent written summary. Needed whenever "research" is needed, to turn raw findings into a readable answer.',
    dependsOn: ['research'],
    buildInput: (task, outputs) => ({ task, findings: outputs.research?.findings ?? [] }),
  },
  {
    name: 'formatter',
    url: 'http://localhost:4003',
    description:
      'deterministic, non-LLM live currency conversion and chart rendering. ONLY needed when the task explicitly involves converting or comparing a monetary amount between currencies.',
    dependsOn: ['writer'],
    buildInput: (task, outputs) => ({ text: outputs.writer?.summary?.body ?? task }),
  },
  {
    name: 'weather',
    url: 'http://localhost:4004',
    description:
      'deterministic, non-LLM live lookup of current weather (temperature, wind, conditions) for a city. Needed when the task asks about weather, temperature, or forecast in a location.',
    buildInput: (task) => ({ task }),
  },
  {
    name: 'analysis',
    url: 'http://localhost:4005',
    description:
      'synthesizes weather and/or currency-conversion results into a short plain-language narrative. Only useful together with "weather" and/or "formatter" — always include it alongside either of those, to explain the numbers in plain language; it produces nothing useful on its own.',
    buildInput: (task, outputs) => ({
      task,
      weather: outputs.weather,
      currency: outputs.formatter,
    }),
  },
];
