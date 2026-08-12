import { ALGORAND_TESTNET_CAIP2 } from "@x402-avm/avm";
import { ExactAvmScheme } from "@x402-avm/avm/exact/client";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402-avm/fetch";
import { config } from "./config.js";
import { deriveSignerFromMnemonic } from "./wallet.js";

/**
 * Drives the real 402-pay-verify-200 flow against this same server's
 * /router/task, using a server-side-only demo payer wallet. The dashboard
 * calls this instead of holding a private key in the browser.
 */
export async function runDemoPayment(task: string) {
  if (!config.demoPayerMnemonic) {
    throw new Error("DEMO_PAYER_MNEMONIC is not set. Add a funded testnet mnemonic to server/.env.");
  }

  const signer = deriveSignerFromMnemonic(config.demoPayerMnemonic);

  const url = `http://localhost:${config.port}/router/task?task=${encodeURIComponent(task)}`;

  const unpaidResponse = await fetch(url);
  const challenged = unpaidResponse.status === 402;
  await unpaidResponse.text(); // drain the body so the connection is released back to the pool

  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: ALGORAND_TESTNET_CAIP2, client: new ExactAvmScheme(signer) }],
  });

  const paidResponse = await fetchWithPayment(url);
  const body = await paidResponse.json();

  let settlement: unknown;
  const paymentResponseHeader =
    paidResponse.headers.get("payment-response") ?? paidResponse.headers.get("PAYMENT-RESPONSE");
  if (paymentResponseHeader) {
    settlement = decodePaymentResponseHeader(paymentResponseHeader);
  }

  return {
    payerAddress: signer.address,
    challenged,
    status: paidResponse.status,
    body,
    settlement,
  };
}
