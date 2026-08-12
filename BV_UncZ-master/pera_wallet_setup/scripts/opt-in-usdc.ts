// opt-in-usdc.ts — algosdk v3 compatible (uses sender/receiver, not from/to)
import algosdk from "algosdk";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.wallets" });

const algod = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");
const USDC_ASA = 10458941;
const roles = ["USER", "ROUTER", "AGENT1", "AGENT2", "AGENT3"];

(async () => {
  const suggestedParams = await algod.getTransactionParams().do();

  for (const role of roles) {
    const addr = process.env[`${role}_ADDR`];
    const mnemonic = process.env[`${role}_MNEMONIC`];

    if (!addr || !mnemonic) {
      throw new Error(`Missing ${role}_ADDR or ${role}_MNEMONIC in .env.wallets`);
    }

    const sk = algosdk.mnemonicToSecretKey(mnemonic).sk;

    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: addr,
      receiver: addr,
      amount: 0,
      assetIndex: USDC_ASA,
      suggestedParams,
    });

    const signed = txn.signTxn(sk);
    const { txid } = await algod.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(algod, txid, 4);
    console.log(`${role} opted in:`, txid);
  }
})();