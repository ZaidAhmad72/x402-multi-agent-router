import type { Context } from "hono";
import { paymentMiddlewareFromConfig } from "@x402-avm/hono";
import { HTTPFacilitatorClient } from "@x402-avm/core/server";
import type { RoutesConfig } from "@x402-avm/core/server";
import { decodePaymentSignatureHeader } from "@x402-avm/core/http";
import { ExactAvmScheme } from "@x402-avm/avm/exact/server";
import { ALGORAND_TESTNET_CAIP2, getTransactionId } from "@x402-avm/avm";
import type { ExactAvmPayloadV2 } from "@x402-avm/avm";
import { config } from "../config.js";

if (!config.payToAddress) {
  throw new Error(
    "PAYTO_ADDRESS is not set. Add your Algorand testnet address to server/.env before starting the server.",
  );
}

const facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });

const routes: RoutesConfig = {
  "GET /router/task": {
    accepts: {
      scheme: "exact",
      payTo: config.payToAddress,
      price: "$0.01",
      network: ALGORAND_TESTNET_CAIP2,
    },
    description: "Multi-agent router task — weather, currency, and AI analysis behind one payment",
  },
};

export const x402Middleware = paymentMiddlewareFromConfig(routes, facilitatorClient, [
  { network: ALGORAND_TESTNET_CAIP2, server: new ExactAvmScheme() },
]);

/**
 * The x402 middleware verifies payment before this route handler runs, but settlement
 * (which submits the transaction) happens after the handler returns, so the settled
 * SettleResponse isn't available inside the handler. Algorand transaction IDs are a
 * deterministic hash of the signed transaction bytes, so we can read the client's
 * already-signed payment transaction straight off the request and compute the same ID
 * the network will assign once the facilitator submits it.
 */
export function extractTransactionId(c: Context): string {
  const header = c.req.header("payment-signature") ?? c.req.header("x-payment");
  if (!header) {
    throw new Error("Missing payment header on a request that passed the x402 middleware.");
  }

  const paymentPayload = decodePaymentSignatureHeader(header);
  const payload = paymentPayload.payload as unknown as ExactAvmPayloadV2;
  const signedTxnBase64 = payload.paymentGroup[payload.paymentIndex];
  const signedTxnBytes = Uint8Array.from(Buffer.from(signedTxnBase64, "base64"));

  return getTransactionId(signedTxnBytes);
}
