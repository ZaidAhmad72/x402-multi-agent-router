/**
 * Phase 2b — atomic group composition and settlement.
 *
 * Budget gate runs before anything is signed. Group size gate runs before
 * anything is signed. Then: one atomic group — one ASA transfer per agent
 * plus one pooled fee-payer transaction — signed once and submitted once.
 * N quotes, one group, one atomic commitment.
 *
 * Stake + slash: an agent that failed the pre-settlement quality gate
 * (router/qualityGate.ts) and has a configured stake wallet (router/stake.ts)
 * gets its normal payout leg swapped for a slash leg in this SAME group —
 * stake wallet -> user, instead of router -> agent. Still one atomic
 * commitment; just a conditional branch per transaction slot instead of a
 * uniform payout to everyone.
 */

import { AlgorandClient, microAlgo } from '@algorandfoundation/algokit-utils';
import {
  ALGOD_TESTNET,
  INDEXER_TESTNET,
  explorerGroupUrl,
  USDC_TESTNET_ASA_ID,
  ROUTING_FEE_MICRO_USDC,
  ROUTING_FEE_USD,
} from '../shared/constants';
import type { QuotePhaseResult } from '../shared/types';
import type { QualityVerdict } from './qualityGate';
import { getStakeConfig, SLASH_AMOUNT_MICRO_USDC } from './stake';

export class BudgetExceededError extends Error {
  constructor(totalUsd: number, maxSpend: number) {
    super(
      `Budget exceeded — quoted total $${totalUsd.toFixed(2)} exceeds maxSpend $${maxSpend.toFixed(2)}. Nothing signed.`
    );
    this.name = 'BudgetExceededError';
  }
}

export class GroupTooLargeError extends Error {
  constructor(size: number) {
    super(
      `Group too large — ${size} transactions exceeds the 16-transaction atomic group limit. Nothing signed.`
    );
    this.name = 'GroupTooLargeError';
  }
}

export interface AgentSettlement {
  agent: string;
  outcome: 'paid' | 'slashed';
  payTo: string;
  txId: string;
  amountMicroUsdc: string;
  index: number;
  reason?: string;
}

export interface SettlementResult {
  groupId: string;
  explorerUrl: string;
  confirmedRound: number;
  perAgent: AgentSettlement[];
  routingFee: { payTo: string; amountMicroUsdc: string; txId: string; index: number };
}

let cachedAlgorand: AlgorandClient | null = null;
function getAlgorandClient(): AlgorandClient {
  if (cachedAlgorand) return cachedAlgorand;
  cachedAlgorand = AlgorandClient.fromConfig({
    algodConfig: { server: ALGOD_TESTNET, port: '', token: '' },
    indexerConfig: { server: INDEXER_TESTNET, port: '', token: '' },
  });
  return cachedAlgorand;
}

export async function settleGroup(
  quotePhase: QuotePhaseResult,
  maxSpend: number,
  qualityVerdicts: QualityVerdict[] = [],
  userAddr?: string
): Promise<SettlementResult> {
  const verdictByAgent = new Map(qualityVerdicts.map((v) => [v.agent, v]));
  const isSlashed = (agent: string) => {
    const v = verdictByAgent.get(agent);
    return !!v && !v.ok && v.staked;
  };

  // Gate 1: budget — before any signing or network call. Only counts what
  // the router itself actually spends: a slashed agent's quoted price never
  // leaves the router's wallet (the rebate comes out of that agent's own
  // stake), so it doesn't count against the user's cap.
  const payableUsd = quotePhase.quotes
    .filter((q) => !isSlashed(q.agent))
    .reduce((sum, q) => sum + Number(q.amountMicroUsdc) / 1_000_000, 0);
  const totalUsdWithFee = payableUsd + ROUTING_FEE_USD;
  if (totalUsdWithFee > maxSpend) {
    throw new BudgetExceededError(totalUsdWithFee, maxSpend);
  }

  // Gate 2: group size — before any signing or network call. Slashing swaps
  // a leg's destination, not its existence, so the count is unaffected.
  const groupSize = quotePhase.quotes.length + 1 + 1; // + routing fee + pooled fee-payer txn
  if (groupSize > 16) {
    throw new GroupTooLargeError(groupSize);
  }

  const routerAddr = process.env.ROUTER_ADDR;
  const routerMnemonic = process.env.ROUTER_MNEMONIC;
  const routerFeeAddr = process.env.ROUTER_FEE_ADDR;
  if (!routerAddr || !routerMnemonic) {
    throw new Error('Missing ROUTER_ADDR / ROUTER_MNEMONIC — cannot sign the settlement group');
  }
  if (!routerFeeAddr) {
    throw new Error('Missing ROUTER_FEE_ADDR — cannot route the fee leg');
  }

  const anySlash = quotePhase.quotes.some((q) => isSlashed(q.agent));
  if (anySlash && !userAddr) {
    throw new Error('A quality-gate slash is pending but no userAddr was provided to receive the rebate');
  }

  const algorand = getAlgorandClient();
  const routerAccount = algorand.account.fromMnemonic(routerMnemonic);
  algorand.setSignerFromAccount(routerAccount);

  // Register a signer for every stake wallet that will actually sign a leg
  // in this group — algokit-utils resolves the signer per sender address.
  const registeredStakeAddrs = new Set<string>();
  for (const quote of quotePhase.quotes) {
    if (!isSlashed(quote.agent)) continue;
    const stake = getStakeConfig(quote.agent);
    if (!stake) {
      throw new Error(`Internal error: ${quote.agent} marked staked+failing but no stake config found`);
    }
    if (!registeredStakeAddrs.has(stake.addr)) {
      algorand.setSignerFromAccount(algorand.account.fromMnemonic(stake.mnemonic));
      registeredStakeAddrs.add(stake.addr);
    }
  }

  const n = quotePhase.quotes.length;
  const pooledFeeMicroAlgo = 1000 * (n + 2); // + routing fee leg + the fee-payer txn itself
  const slashedCount = quotePhase.quotes.filter((q) => isSlashed(q.agent)).length;

  console.log(
    `\nSETTLE — building one atomic group: ${n - slashedCount} payout(s)` +
      (slashedCount ? ` + ${slashedCount} slash(es)` : '') +
      ` + 1 routing fee + 1 fee-payer txn (pooled fee ${pooledFeeMicroAlgo} microAlgo)`
  );

  let composer = algorand.newGroup();
  for (const quote of quotePhase.quotes) {
    if (isSlashed(quote.agent)) {
      const stake = getStakeConfig(quote.agent)!;
      composer = composer.addAssetTransfer({
        sender: stake.addr,
        receiver: userAddr!,
        assetId: BigInt(USDC_TESTNET_ASA_ID),
        amount: SLASH_AMOUNT_MICRO_USDC,
        staticFee: microAlgo(0),
        note: `x402 quality-gate slash: ${quote.agent}`,
      });
    } else {
      composer = composer.addAssetTransfer({
        sender: routerAddr,
        receiver: quote.payTo,
        assetId: BigInt(USDC_TESTNET_ASA_ID),
        amount: BigInt(quote.amountMicroUsdc),
        staticFee: microAlgo(0),
      });
    }
  }
  const routingFeeIndex = n;
  composer = composer.addAssetTransfer({
    sender: routerAddr,
    receiver: routerFeeAddr,
    assetId: BigInt(USDC_TESTNET_ASA_ID),
    amount: ROUTING_FEE_MICRO_USDC,
    staticFee: microAlgo(0),
    note: 'x402 router routing fee',
  });
  composer = composer.addPayment({
    sender: routerAddr,
    receiver: routerAddr,
    amount: microAlgo(0),
    staticFee: microAlgo(pooledFeeMicroAlgo),
    note: 'x402 router pooled fee payer',
  });

  const result = await composer.send();

  const groupId = result.groupId;
  const confirmedRound = Number(result.confirmations[0]?.confirmedRound ?? 0n);
  const explorerUrl = explorerGroupUrl(confirmedRound, groupId);

  const perAgent: AgentSettlement[] = quotePhase.quotes.map((quote, i) => {
    const slashed = isSlashed(quote.agent);
    return {
      agent: quote.agent,
      outcome: slashed ? 'slashed' : 'paid',
      payTo: slashed ? userAddr! : quote.payTo,
      txId: result.txIds[i],
      amountMicroUsdc: slashed ? SLASH_AMOUNT_MICRO_USDC.toString() : quote.amountMicroUsdc,
      index: i,
      reason: slashed ? verdictByAgent.get(quote.agent)?.reason : undefined,
    };
  });

  const routingFee = {
    payTo: routerFeeAddr,
    amountMicroUsdc: ROUTING_FEE_MICRO_USDC.toString(),
    txId: result.txIds[routingFeeIndex],
    index: routingFeeIndex,
  };

  console.log(`SETTLE complete — groupId=${groupId} confirmedRound=${confirmedRound}`);
  console.log(`  explorer: ${explorerUrl}\n`);

  return { groupId, explorerUrl, confirmedRound, perAgent, routingFee };
}
