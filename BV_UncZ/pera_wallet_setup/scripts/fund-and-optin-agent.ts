// fund-and-optin-agent.ts — one-off: fund a new agent wallet with ALGO from
// ROUTER (min balance + one ASA opt-in) and opt it into the USDC ASA. Run
// manually after add-agent-wallet.ts, once algod is reachable.
import algosdk from "algosdk";
import * as path from "path";
import * as dotenv from "dotenv";

const ENV_PATH = path.join(__dirname, "..", "..", ".env.wallets");
dotenv.config({ path: ENV_PATH });

const algod = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");
const USDC_ASA = 10458941;
const FUND_ALGO_MICRO = 300_000; // 0.3 ALGO — min balance + opt-in + fee buffer
const ROLE = process.argv[2];

if (!ROLE) {
  console.error("Usage: tsx fund-and-optin-agent.ts <ROLE>  (e.g. AGENT4)");
  process.exit(1);
}

(async () => {
  const routerAddr = process.env.ROUTER_ADDR;
  const routerMnemonic = process.env.ROUTER_MNEMONIC;
  const addr = process.env[`${ROLE}_ADDR`];
  const mnemonic = process.env[`${ROLE}_MNEMONIC`];
  if (!routerAddr || !routerMnemonic) throw new Error("Missing ROUTER_ADDR / ROUTER_MNEMONIC");
  if (!addr || !mnemonic) throw new Error(`Missing ${ROLE}_ADDR / ${ROLE}_MNEMONIC`);

  const routerSk = algosdk.mnemonicToSecretKey(routerMnemonic).sk;
  const sk = algosdk.mnemonicToSecretKey(mnemonic).sk;

  const sp1 = await algod.getTransactionParams().do();
  const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: routerAddr,
    receiver: addr,
    amount: FUND_ALGO_MICRO,
    suggestedParams: sp1,
  });
  const { txid: fundTxId } = await algod.sendRawTransaction(fundTxn.signTxn(routerSk)).do();
  await algosdk.waitForConfirmation(algod, fundTxId, 4);
  console.log(`Funded ${FUND_ALGO_MICRO / 1e6} ALGO from ROUTER -> ${ROLE}: ${fundTxId}`);

  const sp2 = await algod.getTransactionParams().do();
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: addr,
    receiver: addr,
    amount: 0,
    assetIndex: USDC_ASA,
    suggestedParams: sp2,
  });
  const { txid: optInTxId } = await algod.sendRawTransaction(optInTxn.signTxn(sk)).do();
  await algosdk.waitForConfirmation(algod, optInTxId, 4);
  console.log(`Opted ${ROLE} into USDC ASA ${USDC_ASA}: ${optInTxId}`);
})();
