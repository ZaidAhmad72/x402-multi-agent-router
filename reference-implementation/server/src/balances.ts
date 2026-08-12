import { config } from "./config.js";
import { deriveSignerFromMnemonic } from "./wallet.js";

const ALGOD_TESTNET = "https://testnet-api.algonode.cloud";
const USDC_TESTNET_ASA_ID = "10458941";

export interface WalletBalance {
  name: string;
  address: string;
  algo: number;
  usdc: number;
}

async function fetchBalance(name: string, address: string): Promise<WalletBalance> {
  if (!address) return { name, address: "", algo: 0, usdc: 0 };

  const res = await fetch(`${ALGOD_TESTNET}/v2/accounts/${address}`);
  if (!res.ok) return { name, address, algo: 0, usdc: 0 };

  const data = (await res.json()) as any;
  const usdcHolding = (data.assets ?? []).find(
    (a: any) => String(a["asset-id"]) === USDC_TESTNET_ASA_ID
  );

  return {
    name,
    address,
    algo: Number(data.amount ?? 0) / 1_000_000,
    usdc: usdcHolding ? Number(usdcHolding.amount) / 1_000_000 : 0,
  };
}

/** Live wallet balances, queried directly from algod — proof the payment flow moves real funds. */
export async function getAllBalances(): Promise<WalletBalance[]> {
  const demoPayerAddress = config.demoPayerMnemonic
    ? deriveSignerFromMnemonic(config.demoPayerMnemonic).address
    : "";

  return Promise.all([
    fetchBalance("router (payTo)", config.payToAddress),
    fetchBalance("demo payer", demoPayerAddress),
  ]);
}
