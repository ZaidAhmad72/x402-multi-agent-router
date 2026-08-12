/**
 * Stake + slash — the accountability layer on top of the atomic group.
 *
 * A "staked" agent has a dedicated wallet (pre-funded once, out of band, via
 * pera_wallet_setup/scripts/seed-stake.ts — never live in the router) that
 * the router holds signing authority over. If that agent's output fails the
 * quality gate, its normal payout leg is swapped for a slash leg in the SAME
 * atomic group: stake wallet -> user, instead of router -> agent. The agent
 * gets nothing; the user gets a rebate; the group still settles as one
 * all-or-nothing unit either way.
 *
 * Config is env-driven and optional per agent: STAKE_<NAME>_ADDR /
 * STAKE_<NAME>_MNEMONIC. An agent with no stake configured falls back to the
 * older, simpler guarantee — a quality failure aborts the whole route
 * (handled in index.ts), since there's no financial accountability to fall
 * back on for that agent.
 */

export interface StakeConfig {
  addr: string;
  mnemonic: string;
}

// Fixed, deliberately decoupled from the agent's quoted price — the slash is
// an accountability penalty, not a fee refund.
export const SLASH_AMOUNT_MICRO_USDC = 500_000n; // 0.5 USDC

export function getStakeConfig(agentName: string): StakeConfig | null {
  const addr = process.env[`STAKE_${agentName.toUpperCase()}_ADDR`];
  const mnemonic = process.env[`STAKE_${agentName.toUpperCase()}_MNEMONIC`];
  if (!addr || !mnemonic) return null;
  return { addr, mnemonic };
}
