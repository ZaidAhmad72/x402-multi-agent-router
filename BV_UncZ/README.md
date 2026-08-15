# Atomic Multi-Agent Service Router

A single orchestration endpoint that accepts one user task, fans it out to three independent
paid AI agents, and **pays all three in one Algorand atomic transaction group** — so either
every agent is paid and the user gets a complete result, or nobody is paid and nothing is
spent.

**N quotes, one group, one atomic commitment.**

The problem this fixes: today an orchestrator calls three paid services sequentially. The
researcher gets paid, the writer gets paid, the designer times out. The user has spent money
and has no deliverable. No rollback, no refund path. Three sequential x402 payments would
also produce three independent group IDs — that's not atomic, it's just three payments that
happened near each other. This project separates the 402 challenge phase from the settlement
phase so N challenges collapse into one group.

Built on Algorand TestNet, `@x402/*` (GoPlausible's x402-on-AVM implementation), and
`@algorandfoundation/algokit-utils`.

---

## Architecture

```
USER              ROUTER                 AGENTS              ALGORAND
 │                  │                       │                    │
 │─ task+budget ───>│                       │                    │
 │                  │── POST /work (x3) ───>│  no payment header │
 │                  │<── 402 + reqs ────────│  (parallel)        │
 │                  │  budget gate + group size gate             │
 │                  │  build ONE group: 3 payouts + 1 fee-payer  │
 │                  │  sign once, submit once ──────────────────>│
 │                  │<────── one group ID ───────────────────────│
 │                  │── X-PAYMENT-GROUP + INDEX ──>│              │
 │                  │                       │─ verify on-chain ─>│
 │                  │                       │  (agent doesn't trust router)
 │                  │<── 200 + result ──────│                    │
 │<─ result + ONE ──│                       │                    │
 │   group ID       │                       │                    │
```

Two legs:

- **Outbound leg (the novelty)** — router quotes all three agents live with no payment
  header, gates on budget and group size *before signing anything*, then builds and submits
  one atomic group: `[0] USDC → research`, `[1] USDC → writer`, `[2] USDC → formatter`,
  `[3] pooled fee-payer`. One group ID, one confirmation.
- **Redeem** — router calls each agent again with `X-PAYMENT-GROUP` / `X-PAYMENT-INDEX`. Each
  agent independently looks up the group via the public indexer and confirms the transaction
  at its index pays *its own* wallet at least its quoted amount — **the agent verifies
  on-chain; it does not trust the router.** A replay guard (checked before any work, never
  after) stops the same proof from being redeemed twice.

Fee abstraction: agent wallets never sign a fee-bearing transaction in this flow — the
router's own wallet fronts one pooled fee for the whole settlement group. The UI's balance
table shows this live: agent ALGO balances stay flat across settlements while their USDC
balances rise.

---

## What's real vs. mocked

| Piece | Status |
|---|---|
| x402 payment challenge/verify/settle (inbound, per-agent quoting) | **Real** — actual 402s, actual `PaymentRequirements`, actual facilitator |
| Atomic group settlement | **Real** — actual signed, submitted, confirmed Algorand TestNet transactions |
| Agent-side on-chain verification | **Real** — actual indexer lookups, no trust in router-supplied data |
| Session Auth & Wallet Verification | **Real** — JWT session tokens, nonce-based wallet ownership challenges (`router/auth.ts`) |
| DAG Execution Planner | **Real** — dependency resolution & DAG workflow execution (`router/plan.ts`) |
| User Reputation & Abuse Guard | **Real** — score tracking, abuse protection, admin management (`router/reputation.ts`, `router/userReputation.ts`) |
| Interactive Tutorial Modal | **Real** — onboarding modal window, persisted completion (`FRONTEND/src/components/TutorialModal.tsx`) |
| research / writer content | **Mocked** — canned findings/summary text (`MOCK=true`); no LLM key wired up. The payment path around them is never mocked. |
| formatter | **Real, deterministic, and intentionally has no LLM path at all** — hard requirement, not a fallback |

---

## Setup

Prerequisites: Node 18+, npm. Wallets are already generated and funded on TestNet
(`.env.wallets` at repo root — gitignored; see `pera_wallet_setup/scripts/` if you need to
regenerate or opt in fresh ones).

```bash
npm install          # installs all workspaces: shared, agents/*, router
```

**Important:** the `@x402/*` and `@algorandfoundation/algokit-utils` versions in every
package.json are pinned to exact versions, not ranges. See `docs/PROBLEMS.md` for why —
newer published versions of `@x402/avm` ship a broken `ALGORAND_TESTNET_CAIP2` constant that
the live facilitator rejects. Do not loosen these pins without re-verifying against the
facilitator's `/supported` endpoint.

Run five processes (four services + this is what the UI drives):

```bash
cd agents/research && npx tsx index.ts     # port 4001
cd agents/writer    && npx tsx index.ts    # port 4002
cd agents/formatter && npx tsx index.ts    # port 4003
cd router           && npx tsx index.ts    # port 4000
```

Open **http://localhost:4000** — the router serves the UI itself. Enter a task and a max
spend, click Route, watch QUOTE → SETTLE → REDEEM light up, and click the group ID to open
it on the TestNet explorer.

To test the failure path live: use the "Demo kill switch" panel (or
`curl -X POST localhost:4000/admin/kill/writer`), then click Route again — it aborts with
zero spend, provably, before any signing happens.

---

## A real settled group ID

This isn't a made-up example — it's a group produced during Phase 4 verification, checked
independently against the public indexer (not just trusted from the router's own response):

- **Group ID:** `CrUKSfQmsGdOuYDnZRb1K18kaJn2rfIzyEdziCAaOhE=`
- **Explorer:** https://lora.algokit.io/testnet/block/66180927/group/CrUKSfQmsGdOuYDnZRb1K18kaJn2rfIzyEdziCAaOhE%3D
- **Confirmed round:** 66180927
- Verified via `testnet-idx.algonode.cloud/v2/transactions?group-id=...`: 4 transactions,
  all `confirmed-round: 66180927` — 3 `axfer` (research/writer/formatter payouts) at
  `intra-round-offset` 0/1/2, plus 1 `pay` (pooled fee-payer) at offset 3.

---

## Known limitation

**Atomic payment is not atomic execution.** Paying three agents in one unbreakable group
does not guarantee any of them returned good output. The mitigation implemented here is the
quote-phase liveness check — a dead agent never enters the group, so the most common failure
(an agent being down) is caught before money moves. If an agent goes down *between*
settlement and redeem (a narrower window), the router surfaces this honestly — `phase:
"SETTLED"`, `settledButNotRedeemed: true`, the real group ID still included — rather than
pretending the redeem succeeded. The full fix is escrow-based conditional release, which is
next-milestone work, not implemented here.

## Explicitly out of scope

Quality escrow, more than ~13 agents (16-transaction group limit), dynamic agent discovery
(the registry is hardcoded by design), streaming/async job payment, mainnet, multi-user/auth,
retry or partial fulfilment (all-or-nothing is the product), and reputation/ranking. See
`CLAUDE.md` §8 for the full list and reasoning.

## Problems encountered

Every real bug hit while building this, with root cause and fix, is logged in
[`docs/PROBLEMS.md`](docs/PROBLEMS.md) — including two upstream dependency surprises
(a broken constant in a newer `@x402/avm` release, and `AlgoAmount` not being exported where
the docs implied it was) that were caught by verifying against the actual installed package
rather than trusting either CLAUDE.md's or the package's own type declarations blindly.
