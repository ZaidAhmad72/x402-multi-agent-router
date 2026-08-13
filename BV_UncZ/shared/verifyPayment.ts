/**
 * Agent-side on-chain payment verification. The agent looks up the group via
 * the indexer and confirms the transaction at its index pays its own wallet
 * at least its quoted amount. The agent verifies on-chain; it does not trust
 * the router.
 */

import { INDEXER_TESTNET, USDC_TESTNET_ASA_ID } from './constants';

export interface VerifyPaymentResult {
  valid: boolean;
  reason?: string;
  txId?: string;
}

export async function verifyGroupPayment(params: {
  groupId: string;
  index: number;
  expectedReceiver: string;
  expectedMinAmountMicroUsdc: bigint;
}): Promise<VerifyPaymentResult> {
  const { groupId, index, expectedReceiver, expectedMinAmountMicroUsdc } = params;

  const url = `${INDEXER_TESTNET}/v2/transactions?group-id=${encodeURIComponent(groupId)}`;

  // The public testnet indexer is shared, rate-limited infra that can also
  // lag a round behind algod right after settle confirms — a bare single
  // fetch turns any transient blip, or that lag (an empty-but-successful
  // response, since the group just isn't indexed yet), into a hard
  // payment-verification failure on money that already moved on-chain.
  // Retry the whole fetch+lookup cycle a few times with backoff before
  // giving up; a real rejection (wrong asset/receiver/amount, or a
  // confirmed txn that just doesn't match) still returns immediately since
  // more retries can't change those.
  const MAX_ATTEMPTS = 4;
  const BACKOFF_MS = [300, 700, 1500];

  let txn: any;
  let lastErr: string | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) {
        lastErr = `indexer returned ${res.status}`;
        if (res.status < 500 && res.status !== 429) {
          return { valid: false, reason: lastErr };
        }
      } else {
        const data = await res.json();
        const txns: any[] = data.transactions ?? [];
        // The indexer's group-id filter already scopes txns to this group,
        // but intra-round-offset is the position within the confirming
        // ROUND, not within the group — it only happens to equal the group
        // index when the group lands alone in a quiet round. Sort by that
        // offset and use array position instead, which is stable regardless
        // of what else confirms in the same round.
        const ordered = [...txns].sort((a, b) => a['intra-round-offset'] - b['intra-round-offset']);
        txn = ordered[index];
        if (txn) break;
        lastErr = `no transaction at index ${index} in group ${groupId}`;
      }
    } catch (err) {
      lastErr = `indexer unreachable: ${(err as Error).message}`;
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    }
  }

  if (!txn) {
    return { valid: false, reason: lastErr ?? 'indexer unreachable: unknown error' };
  }
  if (!txn['confirmed-round']) {
    return { valid: false, reason: `transaction at index ${index} is not yet confirmed` };
  }
  if (txn['tx-type'] !== 'axfer') {
    return { valid: false, reason: `transaction at index ${index} is not an asset transfer` };
  }

  const transfer = txn['asset-transfer-transaction'];
  if (!transfer) {
    return { valid: false, reason: `transaction at index ${index} has no asset-transfer payload` };
  }
  if (String(transfer['asset-id']) !== String(USDC_TESTNET_ASA_ID)) {
    return {
      valid: false,
      reason: `wrong asset: expected ${USDC_TESTNET_ASA_ID}, got ${transfer['asset-id']}`,
    };
  }
  if (transfer.receiver !== expectedReceiver) {
    return {
      valid: false,
      reason: `wrong receiver: expected ${expectedReceiver}, got ${transfer.receiver}`,
    };
  }

  const amount = BigInt(transfer.amount);
  if (amount < expectedMinAmountMicroUsdc) {
    return {
      valid: false,
      reason: `underpaid: expected >= ${expectedMinAmountMicroUsdc}, got ${amount}`,
    };
  }

  return { valid: true, txId: txn.id };
}
