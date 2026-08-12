// fund-stake-usdc.ts — one-off: send USDC from ROUTER to a stake wallet so a
// real slash can be demonstrated end-to-end. Run manually, not part of the
// live router.
import algosdk from "algosdk";
import * as path from "path";
import * as dotenv from "dotenv";

const ENV_PATH = path.join(__dirname, "..", "..", ".env.wallets");
dotenv.config({ path: ENV_PATH });

const algod = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");
const USDC_ASA = 10458941;
const STAKE_AGENT = process.argv[2] || "FORMATTER";
const AMOUNT_MICRO_USDC = parseInt(process.argv[3] || "2000000", 10); // default 2 USDC

(async () => {
  const routerAddr = process.env.ROUTER_ADDR;
  const routerMnemonic = process.env.ROUTER_MNEMONIC;
  const stakeAddr = process.env[`STAKE_${STAKE_AGENT}_ADDR`];
  if (!routerAddr || !routerMnemonic) throw new Error("Missing ROUTER_ADDR / ROUTER_MNEMONIC");
  if (!stakeAddr) throw new Error(`Missing STAKE_${STAKE_AGENT}_ADDR`);

  const sk = algosdk.mnemonicToSecretKey(routerMnemonic).sk;
  const sp = await algod.getTransactionParams().do();

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: routerAddr,
    receiver: stakeAddr,
    amount: AMOUNT_MICRO_USDC,
    assetIndex: USDC_ASA,
    suggestedParams: sp,
  });
  const signed = txn.signTxn(sk);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  console.log(`Sent ${AMOUNT_MICRO_USDC / 1e6} USDC from ROUTER -> STAKE_${STAKE_AGENT} (${stakeAddr}): ${txid}`);
})();
