import "dotenv/config";
import algosdk from "algosdk"; // only for mnemonic -> secret key bytes; never used to build/sign txns directly
import { toClientAvmSigner, ALGORAND_TESTNET_CAIP2 } from "@x402/avm";
import { ExactAvmScheme } from "@x402/avm/exact/client";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";

/**
 * The complete x402 client loop against ONE agent's payment-gated /work
 * route, run directly (not mediated through the router). Demonstrates the
 * steps the router's own settle-by-direct-transfer flow never exercises:
 * unpaid request -> 402 -> client signs -> paid retry -> 200 + decoded
 * settlement receipt.
 */

const AGENT_URL = process.argv[2] ?? "http://localhost:4001/work";
const { USER_MNEMONIC } = process.env;

if (!USER_MNEMONIC) {
  throw new Error("USER_MNEMONIC is not set. Add it to .env.wallets at the repo root.");
}

const sk = algosdk.mnemonicToSecretKey(USER_MNEMONIC.trim()).sk;
const privateKeyBase64 = Buffer.from(sk).toString("base64");
const signer = toClientAvmSigner(privateKeyBase64);

console.log(`Payer address: ${signer.address}`);
console.log(`Target: ${AGENT_URL}\n`);

console.log("1) Calling unpaid (expecting 402)...");
const unpaidResponse = await fetch(AGENT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
console.log(`   Status: ${unpaidResponse.status}`);
if (unpaidResponse.status !== 402) {
  console.log("   Unexpected: expected 402, got", unpaidResponse.status, await unpaidResponse.text());
}

console.log("\n2) Retrying with automatic x402 payment...");
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: ALGORAND_TESTNET_CAIP2, client: new ExactAvmScheme(signer) }],
});

const paidResponse = await fetchWithPayment(AGENT_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
console.log(`   Status: ${paidResponse.status}`);

const body = await paidResponse.json();
console.log("   Response body:", body);

const paymentResponseHeader = paidResponse.headers.get("payment-response") ?? paidResponse.headers.get("PAYMENT-RESPONSE");
if (paymentResponseHeader) {
  console.log("   Settlement receipt:", decodePaymentResponseHeader(paymentResponseHeader));
}

const pr = paidResponse.headers.get("payment-required");
if (pr) {
  console.log("\n   Rejection detail:", JSON.parse(Buffer.from(pr, "base64").toString()).error);
}
