// check-balance.ts — algosdk v3 compatible (amounts are BigInt, must convert explicitly)
import algosdk from "algosdk";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.wallets" });

const algod = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");
const USDC_ASA = 10458941;
const roles = ["USER", "ROUTER", "ROUTER_FEE", "AGENT1", "AGENT2", "AGENT3", "AGENT4", "AGENT5"];

(async () => {
  for (const role of roles) {
    const addr = process.env[`${role}_ADDR`];
    if (!addr) throw new Error(`Missing ${role}_ADDR in .env.wallets`);

    const info = await algod.accountInformation(addr).do();
    const usdc = info.assets?.find((a: any) => Number(a.assetId ?? a["asset-id"]) === USDC_ASA);

    const algoAmount = Number(info.amount) / 1e6;
    const usdcAmount = usdc ? Number(usdc.amount) / 1e6 : null;

    console.log(
      role,
      "ALGO:", algoAmount,
      "| USDC opted-in:", !!usdc,
      "| USDC balance:", usdcAmount ?? "n/a"
    );
  }
})();