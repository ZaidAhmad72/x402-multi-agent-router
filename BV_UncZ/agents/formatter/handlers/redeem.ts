import type { Context } from 'hono';
import { verifyGroupPayment } from '../../../shared/verifyPayment';
import { guard } from '../guard';
import { runFormatter } from './work';
import { PRICE_USD } from '../endpoints.config';

const EXPECTED_MIN_MICRO_USDC = BigInt(Math.round(PRICE_USD * 1_000_000));

/**
 * POST /redeem
 * Not payment-gated by x402 middleware — this is the outbound-leg proof path.
 * The agent verifies on-chain; it does not trust the router.
 */
export async function handleFormatterRedeem(c: Context) {
  const avmAddress = process.env.AVM_ADDRESS_FORMATTER as string;
  const groupId = c.req.header('x-payment-group');
  const indexHeader = c.req.header('x-payment-index');

  if (!groupId || indexHeader === undefined) {
    return c.json({ error: 'Missing X-PAYMENT-GROUP or X-PAYMENT-INDEX header' }, 400);
  }
  const index = Number(indexHeader);
  if (!Number.isInteger(index) || index < 0) {
    return c.json({ error: 'X-PAYMENT-INDEX must be a non-negative integer' }, 400);
  }

  // Replay guard — checked before any work, never after.
  try {
    guard(groupId, index);
  } catch {
    return c.json({ error: 'replay rejected — this group+index has already been redeemed' }, 409);
  }

  const verification = await verifyGroupPayment({
    groupId,
    index,
    expectedReceiver: avmAddress,
    expectedMinAmountMicroUsdc: EXPECTED_MIN_MICRO_USDC,
  });

  if (!verification.valid) {
    console.error(`✗ REDEEM verification failed for formatter: ${verification.reason}`);
    return c.json({ error: `Payment verification failed: ${verification.reason}` }, 402);
  }

  console.log(`✓ REDEEM verified on-chain for formatter — txId=${verification.txId}`);

  const body = await c.req.json().catch(() => ({}));
  const text: string = typeof body?.text === 'string' ? body.text : '';

  return c.json({
    ...(await runFormatter(text)),
    verifiedTxId: verification.txId,
  });
}
