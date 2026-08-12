// seed-stake.ts — run once before demo, not part of the live router.
// Generates a stake wallet for one agent (default: formatter — fastest/
// simplest to demo per the stake+slash plan), funds it with enough ALGO from
// ROUTER for min-balance + one ASA opt-in, opts it into the USDC ASA, and
// appends its address+mnemonic to .env.wallets. Actually loading it with
// USDC to slash is a separate, still-open step (same faucet blocker as every
// other wallet in this project) — this script only gets the wallet to a
// mechanically-ready state.
import algosdk from "algosdk";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

const ENV_PATH = path.join(__dirname, "..", "..", ".env.wallets");
dotenv.config({ path: ENV_PATH });

const algod = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");
const USDC_ASA = 10458941;
const FUND_ALGO_MICRO = 300_000; // 0.3 ALGO — covers 0.1 min balance + 0.1 ASA opt-in + fees
const STAKE_AGENT = process.argv[2] || "FORMATTER";

(async () => {
  const routerAddr = process.env.ROUTER_ADDR;
  const routerMnemonic = process.env.ROUTER_MNEMONIC;
  if (!routerAddr || !routerMnemonic) {
    throw new Error("Missing ROUTER_ADDR / ROUTER_MNEMONIC in .env.wallets");
  }

  const envKeyAddr = `STAKE_${STAKE_AGENT}_ADDR`;
  const envKeyMnemonic = `STAKE_${STAKE_AGENT}_MNEMONIC`;
  if (process.env[envKeyAddr]) {
    console.log(`${envKeyAddr} already set in .env.wallets — not overwriting. Delete it manually to regenerate.`);
    return;
  }

  const stakeAccount = algosdk.generateAccount();
  const stakeMnemonic = algosdk.secretKeyToMnemonic(stakeAccount.sk);
  console.log(`Generated stake wallet for ${STAKE_AGENT}: ${stakeAccount.addr}`);

  const routerSk = algosdk.mnemonicToSecretKey(routerMnemonic).sk;
  const sp = await algod.getTransactionParams().do();

  // 1) Fund the new wallet with ALGO from ROUTER.
  const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: routerAddr,
    receiver: stakeAccount.addr,
    amount: FUND_ALGO_MICRO,
    suggestedParams: sp,
  });
  const fundSigned = fundTxn.signTxn(routerSk);
  const { txid: fundTxId } = await algod.sendRawTransaction(fundSigned).do();
  await algosdk.waitForConfirmation(algod, fundTxId, 4);
  console.log(`Funded ${FUND_ALGO_MICRO / 1e6} ALGO from ROUTER -> stake wallet: ${fundTxId}`);

  // 2) Opt the new wallet into the USDC ASA.
  const sp2 = await algod.getTransactionParams().do();
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: stakeAccount.addr,
    receiver: stakeAccount.addr,
    amount: 0,
    assetIndex: USDC_ASA,
    suggestedParams: sp2,
  });
  const optInSigned = optInTxn.signTxn(stakeAccount.sk);
  const { txid: optInTxId } = await algod.sendRawTransaction(optInSigned).do();
  await algosdk.waitForConfirmation(algod, optInTxId, 4);
  console.log(`Opted stake wallet into USDC ASA ${USDC_ASA}: ${optInTxId}`);

  // 3) Append (never overwrite) to .env.wallets.
  const block = `\n\nSTAKE_${STAKE_AGENT}_ADDR=${stakeAccount.addr}\nSTAKE_${STAKE_AGENT}_MNEMONIC="${stakeMnemonic}"\n`;
  fs.appendFileSync(ENV_PATH, block);
  console.log(`Appended ${envKeyAddr} / ${envKeyMnemonic} to .env.wallets`);
  console.log(
    `\nStake wallet is funded with ALGO and opted into USDC, but has 0 USDC —` +
    ` same as every other wallet in this project, it needs real testnet USDC before a slash can actually settle.`
  );
})();
