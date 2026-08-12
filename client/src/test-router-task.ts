import "dotenv/config";
import nacl from "tweetnacl";
import { seedFromMnemonic } from "@algorandfoundation/algokit-utils/algo25";
import { toClientAvmSigner, ALGORAND_TESTNET_CAIP2 } from "@x402-avm/avm";
import { ExactAvmScheme } from "@x402-avm/avm/exact/client";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402-avm/fetch";

const { SERVER_URL = "http://localhost:3000", CLIENT_WALLET_MNEMONIC } = process.env;

if (!CLIENT_WALLET_MNEMONIC) {
  throw new Error("CLIENT_WALLET_MNEMONIC is not set. Add your funded testnet mnemonic to client/.env.");
}

const seed = seedFromMnemonic(CLIENT_WALLET_MNEMONIC.trim());
const keyPair = nacl.sign.keyPair.fromSeed(seed);
const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString("base64");

const signer = toClientAvmSigner(privateKeyBase64);
console.log(`Using wallet address: ${signer.address}`);

const url = `${SERVER_URL}/router/task`;

console.log(`\n1) Calling ${url} without payment (expecting 402)...`);
const unpaidResponse = await fetch(url);
console.log(`   Status: ${unpaidResponse.status}`);
if (unpaidResponse.status !== 402) {
  console.log("   Unexpected: expected 402, got", unpaidResponse.status, await unpaidResponse.text());
}

console.log("\n2) Retrying with automatic x402 payment...");
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: ALGORAND_TESTNET_CAIP2, client: new ExactAvmScheme(signer) }],
});

const paidResponse = await fetchWithPayment(url);
console.log(`   Status: ${paidResponse.status}`);

const body = await paidResponse.json();
console.log("   Response body:", body);

const paymentResponseHeader = paidResponse.headers.get("payment-response") ?? paidResponse.headers.get("PAYMENT-RESPONSE");
if (paymentResponseHeader) {
  console.log("   Settlement details:", decodePaymentResponseHeader(paymentResponseHeader));
}
