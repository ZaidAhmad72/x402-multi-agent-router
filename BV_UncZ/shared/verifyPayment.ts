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
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return { valid: false, reason: `indexer unreachable: ${(err as Error).message}` };
  }
  if (!res.ok) {
    return { valid: false, reason: `indexer returned ${res.status}` };
  }

  const data = await res.json();
  const txns: any[] = data.transactions ?? [];
  // The indexer's group-id filter already scopes txns to this group, but
  // intra-round-offset is the position within the confirming ROUND, not
  // within the group — it only happens to equal the group index when the
  // group lands alone in a quiet round. Sort by that offset and use array
  // position instead, which is stable regardless of what else confirms in
  // the same round.
  const ordered = [...txns].sort((a, b) => a['intra-round-offset'] - b['intra-round-offset']);
  const txn = ordered[index];

  if (!txn) {
    return { valid: false, reason: `no transaction at index ${index} in group ${groupId}` };
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
