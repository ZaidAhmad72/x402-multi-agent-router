// Shared types between the dev/debug view and the user-facing chat view.
// Both read the same /route and /debug/preview response shapes from the
// router (see BV_UncZ/router/index.ts) — kept here once so neither view
// drifts from the other's idea of what the backend returns.

export type QualityVerdict = {
  agent: string;
  ok: boolean;
  reason: string;
  staked: boolean;
};

export type Settlement = {
  groupId: string;
  explorerUrl: string;
  confirmedRound: number;
};

export type ReceiptRow = {
  agent: string;
  outcome: 'paid' | 'slashed' | string;
  amountUsd: number;
};

// Router is registry-driven, so `result` is a bag of whatever agents ran —
// each entry's real shape is one of the *Output interfaces in
// BV_UncZ/agents/*/handlers/work.ts. Kept loose here; src/lib/answer.ts is
// the one place that knows each agent's actual fields.
export type AgentResults = Record<string, any>;

export type RouteResponseData = {
  error?: string;
  zeroSpend?: boolean;
  phase?: string;
  qualityVerdicts?: QualityVerdict[];
  settlement?: Settlement;
  receipt?: ReceiptRow[];
  result?: AgentResults;
};

export type Message = {
  id: string;
  sender: 'user' | 'agent' | 'system';
  text?: string;
  html?: string;
  isThinking?: boolean;
  /** Raw /route (or /debug/preview) response this message was rendered from — lets any view reconstruct its own presentation instead of only the pre-rendered `html`. Absent on messages loaded from history. */
  raw?: RouteResponseData;
  /** Snapshot of the live progress log at the moment this message completed, for a per-message "what did it do" trace. */
  steps?: string[];
  /** True if `raw` came from /debug/preview (free trial run, no payment) rather than a real settled /route call. */
  isPreview?: boolean;
};

export type Balance = { name: string; address: string; algo: number; usdc: number };
export type Agent = { name: string; url: string; description: string };
export type QualityGateMode = 'auto' | 'pass' | 'fail';
export type Session = { chatId: string; title: string; updatedAt: string };
export type Phase = 'IDLE' | 'QUALITY' | 'QUOTE' | 'SETTLE' | 'REDEEM' | 'REDEEMED' | 'ERROR';

// From GET /reputation/:username — see BV_UncZ/router/userReputation.ts and
// docs/USER-REPUTATION.md. `category` is computed server-side (single
// source of truth for the score->label mapping) so the frontend never needs
// its own copy of the thresholds.
export type Reputation = {
  username: string;
  reputation: number;
  category: { label: string; description: string };
};
