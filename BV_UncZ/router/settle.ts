/**
 * Phase 2b — atomic group composition and settlement.
 *
 * Budget gate runs before anything is signed. Group size gate runs before
 * anything is signed. Then: one atomic group — one ASA transfer per agent
 * plus one pooled fee-payer transaction — signed once and submitted once.
 * N quotes, one group, one atomic commitment.
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
  payTo: string;
  txId: string;
  amountMicroUsdc: string;
  index: number;
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
  maxSpend: number
): Promise<SettlementResult> {
  // Gate 1: budget — before any signing or network call. Includes the
  // routing fee, not just agent pass-through costs, so maxSpend is an
  // honest cap on everything the group actually moves.
  const totalUsdWithFee = quotePhase.totalUsd + ROUTING_FEE_USD;
  if (totalUsdWithFee > maxSpend) {
    throw new BudgetExceededError(totalUsdWithFee, maxSpend);
  }

  // Gate 2: group size — before any signing or network call.
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

  const algorand = getAlgorandClient();
  const routerAccount = algorand.account.fromMnemonic(routerMnemonic);
  algorand.setSignerFromAccount(routerAccount);

  const n = quotePhase.quotes.length;
  const pooledFeeMicroAlgo = 1000 * (n + 2); // + routing fee leg + the fee-payer txn itself

  console.log(
    `\nSETTLE — building one atomic group: ${n} payout(s) + 1 routing fee + 1 fee-payer txn (pooled fee ${pooledFeeMicroAlgo} microAlgo)`
  );

  let composer = algorand.newGroup();
  for (const quote of quotePhase.quotes) {
    composer = composer.addAssetTransfer({
      sender: routerAddr,
      receiver: quote.payTo,
      assetId: BigInt(USDC_TESTNET_ASA_ID),
      amount: BigInt(quote.amountMicroUsdc),
      staticFee: microAlgo(0),
    });
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

  const perAgent: AgentSettlement[] = quotePhase.quotes.map((quote, i) => ({
    agent: quote.agent,
    payTo: quote.payTo,
    txId: result.txIds[i],
    amountMicroUsdc: quote.amountMicroUsdc,
    index: i,
  }));

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
