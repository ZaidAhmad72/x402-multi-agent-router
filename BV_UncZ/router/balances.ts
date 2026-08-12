/**
 * Live wallet balances, queried directly from algod — not hardcoded. Used by
 * the UI to show real agent ALGO balances, demonstrating fee abstraction:
 * agents receive USDC via the atomic settlement but never need to sign a
 * fee-bearing transaction themselves, so their ALGO balance stays flat.
 */

import { ALGOD_TESTNET, USDC_TESTNET_ASA_ID } from '../shared/constants';

export interface WalletBalance {
  name: string;
  address: string;
  algo: number;
  usdc: number;
}

async function fetchBalance(name: string, address?: string): Promise<WalletBalance> {
  if (!address) {
    return { name, address: '', algo: 0, usdc: 0 };
  }
  try {
    const res = await fetch(`${ALGOD_TESTNET}/v2/accounts/${address}`);
    if (!res.ok) {
      return { name, address, algo: 0, usdc: 0 };
    }
    const data = await res.json();
    const usdcHolding = (data.assets ?? []).find(
      (a: any) => String(a['asset-id']) === String(USDC_TESTNET_ASA_ID)
    );
    return {
      name,
      address,
      algo: Number(data.amount ?? 0) / 1_000_000,
      usdc: usdcHolding ? Number(usdcHolding.amount) / 1_000_000 : 0,
    };
  } catch {
    return { name, address, algo: 0, usdc: 0 };
  }
}

export async function getAllBalances(): Promise<WalletBalance[]> {
  return Promise.all([
    fetchBalance('router', process.env.ROUTER_ADDR),
    fetchBalance('research', process.env.AGENT1_ADDR),
    fetchBalance('writer', process.env.AGENT2_ADDR),
    fetchBalance('formatter', process.env.AGENT3_ADDR),
  ]);
}
