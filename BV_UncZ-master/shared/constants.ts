// Re-exported from @x402/avm so this stays the single source of truth
// (see reference/x402-starter/x402-demo-server/endpoints.config.ts)
export { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID } from '@x402/avm';

export const FACILITATOR_URL = 'https://facilitator.goplausible.xyz';
export const ALGOD_TESTNET = 'https://testnet-api.algonode.cloud';
export const INDEXER_TESTNET = 'https://testnet-idx.algonode.cloud';

// CLAUDE.md's constant (`.../testnet/group/<id>`) 404s — Lora's real route
// includes the confirming block/round. Verified by clicking through Lora's
// own transaction -> group link rather than guessing (see docs/PROBLEMS.md).
export function explorerGroupUrl(confirmedRound: number, groupId: string): string {
  return `https://lora.algokit.io/testnet/block/${confirmedRound}/group/${encodeURIComponent(groupId)}`;
}

export interface AgentRegistryEntry {
  name: string;
  url: string;
}

// Hardcoded by design — dynamic agent discovery (Bazaar) is out of scope (CLAUDE.md §8).
export const AGENT_REGISTRY: AgentRegistryEntry[] = [
  { name: 'research', url: 'http://localhost:4001' },
  { name: 'writer', url: 'http://localhost:4002' },
  { name: 'formatter', url: 'http://localhost:4003' },
];
