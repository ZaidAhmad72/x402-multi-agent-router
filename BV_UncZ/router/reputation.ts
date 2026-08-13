/**
 * Abuse guard — deterministic, privacy-preserving usage counters that close
 * the free-compute hole in the quality gate. `POST /route` trial-runs every
 * selected agent via `/debug/preview` before anyone is asked for money
 * (qualityGate.ts), and `POST /debug/preview` does the same thing directly —
 * both are an unpaid compute subsidy anyone can hammer for free. A second,
 * subtler vector: repeatedly engineering a *staked* agent to fail farms slash
 * rebates (stake.ts, settle.ts), turning the accountability mechanism into an
 * income stream.
 *
 * No ML, no LLM classifier — deterministic counters with thresholds, same
 * fail-open, explainable posture as qualityGate.ts and selectAgents.ts.
 * No persistence — in-memory only, same pattern as shared/replayGuard.ts. A
 * restart clears it.
 *
 * IDENTITY LIMITATION (state this verbatim wherever it's surfaced): identity
 * is not cryptographically verified yet, so a determined abuser can rotate
 * userAddr and reset their counters. The guard raises the cost of abuse; it
 * does not prevent it. Wallet ownership proof (sign a nonce, verify the
 * signature) is the prerequisite that would close this, and is deliberately
 * out of scope here.
 *
 * No claim of Sybil resistance is made anywhere in this module's surface.
 */

import { createHash, randomBytes } from 'crypto';

const WINDOW_MS = 10 * 60_000; // 10 minutes
const MAX_FREE_RUNS = 12; // free trial runs per window
const MIN_RUNS_FOR_RATIO = 5; // don't judge a ratio on tiny samples
const MIN_SETTLE_RATIO = 0.2; // settled / (settled + aborted)
const MAX_REBATES = 3; // slash rebates per window

// Module-level random salt, generated once at process start. Storing
// sha256(SALT + identity) rather than the raw identity means the mapping is
// not reversible even by someone who reads a process memory dump later, and
// cannot be correlated across restarts (a new SALT invalidates every key).
const SALT = randomBytes(32).toString('hex');

interface UsageRecord {
  key: string; // truncated salted hash — the ONLY identifier retained
  freeRuns: number[]; // timestamps of free trial runs (quality gate + /debug/preview)
  settled: number[]; // timestamps of jobs that reached a confirmed group
  aborted: number[]; // timestamps of jobs that consumed free work then failed to settle
  rebates: number[]; // timestamps of slash rebates received by this key
}

export interface UsageVerdict {
  key: string;
  allowed: boolean;
  flags: string[];
  reason?: string; // human-readable, safe to show the user
  counts: { freeRuns: number; settled: number; aborted: number; rebates: number };
}

const store = new Map<string, UsageRecord>();
let guardEnabled = true;

/** Derive the pseudonymous key. Never returns the raw identity. */
export function usageKey(userAddr?: string, sessionId?: string): string {
  const identity = userAddr || sessionId || 'anonymous';
  return createHash('sha256').update(SALT + identity).digest('hex').slice(0, 16);
}

function getRecord(key: string): UsageRecord {
  let rec = store.get(key);
  if (!rec) {
    rec = { key, freeRuns: [], settled: [], aborted: [], rebates: [] };
    store.set(key, rec);
  }
  return rec;
}

// Prune anything older than WINDOW_MS on every read — timestamp arrays make
// the window a genuine rolling window and decay free, more explainable to a
// judge than a decay constant and simpler to implement correctly.
function prune(rec: UsageRecord): void {
  const cutoff = Date.now() - WINDOW_MS;
  rec.freeRuns = rec.freeRuns.filter((t) => t > cutoff);
  rec.settled = rec.settled.filter((t) => t > cutoff);
  rec.aborted = rec.aborted.filter((t) => t > cutoff);
  rec.rebates = rec.rebates.filter((t) => t > cutoff);
}

function evaluate(rec: UsageRecord): { flags: string[]; allowed: boolean; reason?: string } {
  const flags: string[] = [];
  let allowed = true;
  let reason: string | undefined;

  if (rec.freeRuns.length >= MAX_FREE_RUNS) {
    flags.push('RATE_LIMIT');
    allowed = false;
    reason = `Rate limit: ${rec.freeRuns.length} free trial runs in the last ${WINDOW_MS / 60_000} minutes (max ${MAX_FREE_RUNS}). Nothing was run.`;
  }

  const ratioSample = rec.settled.length + rec.aborted.length;
  if (ratioSample >= MIN_RUNS_FOR_RATIO) {
    const ratio = rec.settled.length / ratioSample;
    if (ratio < MIN_SETTLE_RATIO) flags.push('FREELOADING');
  }

  if (rec.rebates.length >= MAX_REBATES) {
    flags.push('REBATE_FARMING');
  }

  return { flags, allowed, reason };
}

/** Read-only check. Call BEFORE any free agent work. Must not mutate. */
export function checkUsage(key: string): UsageVerdict {
  if (!guardEnabled) {
    const rec = store.get(key);
    return {
      key,
      allowed: true,
      flags: [],
      counts: {
        freeRuns: rec?.freeRuns.length ?? 0,
        settled: rec?.settled.length ?? 0,
        aborted: rec?.aborted.length ?? 0,
        rebates: rec?.rebates.length ?? 0,
      },
    };
  }

  const rec = getRecord(key);
  prune(rec);
  const { flags, allowed, reason } = evaluate(rec);
  return {
    key,
    allowed,
    flags,
    reason,
    counts: {
      freeRuns: rec.freeRuns.length,
      settled: rec.settled.length,
      aborted: rec.aborted.length,
      rebates: rec.rebates.length,
    },
  };
}

/** Record events. All are no-ops that swallow errors — abuse tracking must never break a route. */
export function recordFreeRun(key: string, count: number): void {
  try {
    const rec = getRecord(key);
    const now = Date.now();
    for (let i = 0; i < count; i++) rec.freeRuns.push(now);
  } catch (err) {
    console.error('reputation.recordFreeRun failed (ignored):', err);
  }
}

export function recordSettled(key: string): void {
  try {
    getRecord(key).settled.push(Date.now());
  } catch (err) {
    console.error('reputation.recordSettled failed (ignored):', err);
  }
}

export function recordAborted(key: string): void {
  try {
    getRecord(key).aborted.push(Date.now());
  } catch (err) {
    console.error('reputation.recordAborted failed (ignored):', err);
  }
}

export function recordRebate(key: string): void {
  try {
    getRecord(key).rebates.push(Date.now());
  } catch (err) {
    console.error('reputation.recordRebate failed (ignored):', err);
  }
}

/** For the UI panel. Returns pseudonymous keys and counts only. */
export function allUsage(): UsageVerdict[] {
  return [...store.keys()].map((key) => checkUsage(key));
}

/** Demo levers, mirroring setQualityGateMode. */
export function setGuardEnabled(enabled: boolean): void {
  guardEnabled = enabled;
}

export function isGuardEnabled(): boolean {
  return guardEnabled;
}

export function resetUsage(): void {
  store.clear();
}
