/**
 * Persisted, account-based reputation. Distinct from reputation.ts's guard:
 * that one is an in-memory, wallet/session-pseudonymous rate limiter with a
 * short rolling window that resets on every restart -- built to catch
 * free-compute abuse *within* a session. This one is long-lived, tied to a
 * logged-in username, stored on that user's own document in `usersCollection`
 * (shared/types/user.ts), and visible to the user themselves in the UI. Full
 * model and reasoning: docs/USER-REPUTATION.md.
 *
 * Update rule, in one line: newRep = oldRep + alpha * (target - oldRep).
 * Every outcome pulls the score toward a target (10 for success, 0 for a bad
 * signal) by a fraction (alpha) of the remaining distance -- an exponential
 * moving average, not a flat add/subtract. Using the OLD score as an input
 * to the new one is the whole point: the same outcome moves a 9 by less than
 * it moves a 3 (both closing the same fraction of a smaller-or-larger gap),
 * which is what makes a single event non-decisive and a sustained pattern
 * decisive -- exactly what a trust score should do.
 */

import { usersCollection } from './db';

export const REPUTATION_MIN = 0;
export const REPUTATION_MAX = 10;
export const REPUTATION_DEFAULT = 8;

export type ReputationOutcome = 'SUCCESS' | 'QUALITY_REJECTED' | 'GUARD_BLOCKED' | 'NEUTRAL';

// target: where this outcome pulls reputation toward, over repeated events.
// alpha: fraction of the gap-to-target closed by ONE event. Trust erodes
// faster than it's earned -- a deliberate, standard reputation-system
// asymmetry (one bad-faith request shouldn't need ~2x as many good ones to
// erase; see docs/USER-REPUTATION.md for the numbers this produces).
//
// Only three outcomes move the score at all:
//  - SUCCESS: the job settled AND redeemed on-chain -- a genuine, paid,
//    completed request.
//  - QUALITY_REJECTED: an unstaked agent's output was rejected by the
//    quality gate before any payment -- the task itself looked adversarial
//    or too low-effort to produce a usable answer.
//  - GUARD_BLOCKED: reputation.ts's rate limiter fired -- the clearest
//    available abuse signal.
// Everything else (network/algonode outages, insufficient testnet funds,
// PLAN's transaction-limit check, a redeem failing after settlement already
// succeeded) is NEUTRAL: infra hiccups and honest misconfiguration are not
// evidence of bad-faith usage, and punishing them would make the score
// unfair and unpredictable to a well-behaved user.
const OUTCOME_PARAMS: Record<Exclude<ReputationOutcome, 'NEUTRAL'>, { target: number; alpha: number }> = {
  SUCCESS: { target: REPUTATION_MAX, alpha: 0.15 },
  QUALITY_REJECTED: { target: REPUTATION_MIN, alpha: 0.25 },
  GUARD_BLOCKED: { target: REPUTATION_MIN, alpha: 0.4 },
};

function clamp(n: number): number {
  return Math.min(REPUTATION_MAX, Math.max(REPUTATION_MIN, n));
}

/** Pure function, no I/O -- exported so the doc's worked examples and the admin page stay verifiable against the real implementation. */
export function nextReputation(current: number, outcome: ReputationOutcome): number {
  if (outcome === 'NEUTRAL') return current;
  const { target, alpha } = OUTCOME_PARAMS[outcome];
  return clamp(current + alpha * (target - current));
}

/**
 * Fire-and-forget: called once at the end of every /route resolution (see
 * router/index.ts). Never awaited by the caller and never throws -- like
 * reputation.ts's recordX functions, bookkeeping must not add latency to,
 * or ever fail, the actual user-facing response.
 */
export function applyReputationOutcome(username: string | undefined, outcome: ReputationOutcome): void {
  if (!username || outcome === 'NEUTRAL') return;
  (async () => {
    try {
      const user = await usersCollection.findOne({ username });
      const current = typeof user?.reputation === 'number' ? user.reputation : REPUTATION_DEFAULT;
      const next = nextReputation(current, outcome);
      await usersCollection.updateOne({ username }, { $set: { reputation: next } });
    } catch (err) {
      console.error(`reputation update failed for ${username} (ignored):`, err);
    }
  })();
}

export interface ReputationCategory {
  label: string;
  description: string;
}

// Single source of truth for score -> label/description -- the frontend
// reads this via GET /reputation/:username rather than reimplementing the
// buckets, so the copy can never drift between the sidebar and the admin
// page.
export function categorizeReputation(score: number): ReputationCategory {
  if (score >= 9) return { label: 'Excellent', description: 'Consistently high-quality, legitimate usage.' };
  if (score >= 7) return { label: 'Good', description: 'Reliable usage history.' };
  if (score >= 5) return { label: 'Fair', description: 'Mixed history — some rejected or blocked requests.' };
  if (score >= 3) return { label: 'Poor', description: 'Frequent rejections or rate-limit blocks.' };
  return { label: 'Untrusted', description: 'Repeated abuse signals — requests may be restricted.' };
}

/** Reads with the same missing-field fallback applyReputationOutcome uses, so a user who's never had an event recorded still sees REPUTATION_DEFAULT, not a crash or a 0. */
export async function getReputation(username: string): Promise<number> {
  const user = await usersCollection.findOne({ username });
  return typeof user?.reputation === 'number' ? user.reputation : REPUTATION_DEFAULT;
}
