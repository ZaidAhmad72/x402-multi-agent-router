/**
 * Replay guard — fixes the known x402 facilitator race condition where a
 * stateless verify lets a valid proof be replayed across concurrent
 * requests. Call guard() before doing any work, never after.
 */

const TTL_MS = 300_000;

export function createReplayGuard() {
  const redeemed = new Map<string, number>();

  return function guard(groupId: string, index: number): void {
    const key = `${groupId}:${index}`;
    const now = Date.now();
    for (const [k, exp] of redeemed) {
      if (exp < now) redeemed.delete(k);
    }
    if (redeemed.has(key)) {
      throw new Error('replay rejected');
    }
    redeemed.set(key, now + TTL_MS);
  };
}
