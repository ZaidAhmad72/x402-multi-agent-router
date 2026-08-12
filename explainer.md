# Explainer — Atomic Multi-Agent Service Router (PS0404)

For teammates joining mid-build. Read this once and you should understand what we're
building, why the repo looks the way it does, what's already done, and what's left.

---

## 1. The problem we're actually solving

**PS0404, AlgoVerse 2026:** pay multiple independent AI agents in **one atomic,
all-or-nothing transaction** — so either every agent gets paid and the caller gets a
complete result, or nobody gets paid and nothing is spent. No partial payment, no "one
agent got paid and the others didn't" state.

Algorand has a native primitive for exactly this: **atomic transaction groups** — up to 16
transactions bundled together, all committing or all failing, enforced by consensus, no
smart contract required. That primitive is the entire point of this project.

---

## 2. Why there are two projects in this repo

Two of us built independently before syncing up:

- **Rohan** built `BV_UncZ/` — three separately-paid agents, fanned in through one real
  atomic settlement group. This is the actual PS0404 submission.
- **Zaid** built `reference-implementation/` — one payment-gated endpoint that bundles
  three services behind a single $0.01 payment. No atomic group anywhere in it (confirmed
  by grepping the codebase — zero hits for "group"/"atomic"/"newGroup"). This is closer to
  a different problem statement (PS0401-shaped: one paid endpoint, not multi-party atomic
  payment).

**Decision: `BV_UncZ/` is the submission.** It's the only one of the two that actually does
what PS0404 asks. `reference-implementation/` is kept in the repo because several of its
pieces are genuinely better than what `BV_UncZ/` had and have been ported over — see §5.

---

## 3. Architecture — how `BV_UncZ/` actually works

Three phases, one HTTP call (`POST /route`) driving all of them:

```
USER              ROUTER                 AGENTS              ALGORAND
 │                  │                       │                    │
 │─ task+budget ───>│                       │                    │
 │                  │── POST /work (x3) ───>│  no payment header │
 │                  │<── 402 + price ───────│  (parallel)        │
 │                  │  budget gate + group-size gate (before signing)
 │                  │  build ONE atomic group: N payouts +       │
 │                  │    1 routing fee + 1 pooled fee-payer ────>│
 │                  │<────── one group ID ───────────────────────│
 │                  │── groupID + index ───>│                    │
 │                  │                       │─ verify on-chain ─>│  (agent checks
 │                  │                       │                    │   itself, doesn't
 │                  │<── 200 + result ──────│                    │   trust the router)
 │<─ result + ONE ──│                       │                    │
 │   group ID       │                       │                    │
```

**QUOTE** (`router/quote.ts`) — hits all three agents' `/work` with no payment header,
expects `402` from each, decodes the price/payTo from each, sums to a total. If any agent
doesn't challenge (dead, misconfigured), the whole thing throws here — **before any money
moves.**

**SETTLE** (`router/settle.ts`) — the actual novelty. Two gates run before any signing:
budget (quoted total + routing fee ≤ maxSpend) and group size (≤16 txns). Then it builds
**one** atomic group: one USDC transfer per agent (fee: 0, pooled), one routing-fee
transfer to a dedicated treasury wallet, one payment transaction that eats the pooled fee
for the whole group. Signs once, submits once, gets back one group ID.

**REDEEM** (`router/redeem.ts`) — calls each agent again with `X-PAYMENT-GROUP` +
`X-PAYMENT-INDEX`. Each agent independently checks the Algorand indexer itself — confirms
the transaction at its index really pays *its own* wallet, at least its quoted amount. **The
agent does not trust the router's word for it.** This was tested adversarially: calling
research's `/redeem` with writer's index correctly returns `402 — wrong receiver`.

**Fee abstraction:** agent wallets never sign a fee-bearing transaction — the router's fee
payer transaction covers the whole group's fees, pooled. (Not "agents hold zero ALGO" —
that's technically false, since holding a USDC ASA requires a small minimum balance. The
accurate claim, already used in the UI/README, is "agents never sign a fee-bearing txn.")

**Also built:** replay guard (same groupId+index can't be redeemed twice — `409` on reuse,
checked *before* any work happens), kill switch (`/admin/kill/:agent` — a killed agent
stops responding, so the quote phase fails and the group is never built, zero spend), and
a routing fee (a 5th leg in the group, so the business model is something you can point at
in the group, not a claim on a slide).

---

## 4. Folder structure

```
x402/
├── README.md                      ← repo overview, points here for detail
├── explainer.md                   ← this file
├── BV_UncZ/                       ← THE SUBMISSION
│   ├── CLAUDE.md                  ← Rohan's original spec/working agreement (unedited)
│   ├── README.md                  ← BV_UncZ's own architecture doc
│   ├── docs/PROBLEMS.md           ← every real bug hit building BV_UncZ, root cause + fix
│   ├── .env.wallets                ← gitignored — USER/ROUTER/ROUTER_FEE/AGENT1-3 wallets
│   ├── shared/                    ← constants (CAIP-2, ASA ID, routing fee), types,
│   │                                 replayGuard, verifyPayment (agent-side on-chain check)
│   ├── agents/
│   │   ├── research/  (port 4001, $0.03) — real Groq findings
│   │   ├── writer/    (port 4002, $0.02) — real Groq synthesis of research's findings
│   │   └── formatter/ (port 4003, $0.01) — real live currency conversion, NO LLM (hard
│   │                                        requirement — heterogeneity is judged)
│   ├── router/         ← index.ts (Hono app), quote.ts, settle.ts, redeem.ts, balances.ts,
│   │                      debugPreview.ts (no-payment testing mode)
│   ├── client/          ← standalone x402 client loop: unpaid → 402 → signed retry → 200
│   │                       + decoded settlement receipt, run directly against one agent
│   ├── ui/               ← dashboard, served by the router itself at :4000
│   └── pera_wallet_setup/scripts/ ← generate-wallets, check-balance, opt-in-usdc
└── reference-implementation/      ← SOURCE MATERIAL, NOT the submission
    ├── docs/PROBLEMS.md            ← its own bug log (facilitator mismatch, faucet
    │                                  failures, 4 regex bugs that motivated an LLM rewrite)
    ├── server/                     ← single endpoint, weather/currency/Groq-analysis
    └── client/                     ← its own test script
```

**Rule of thumb:** if you're demoing, working on the submission, or fixing a bug that
matters for judging — you're in `BV_UncZ/`. `reference-implementation/` only matters as a
source of things to port over.

---

## 5. What's been merged from `reference-implementation/` into `BV_UncZ/`

Everything below is **done, verified live, committed, and pushed**:

| # | What | From | Verified how |
|---|---|---|---|
| — | `intra-round-offset` bug fix | (bug found in `BV_UncZ` itself) | Was trusted as group-relative; it's round-relative. Now sorted+indexed by position. Would've silently broken redeem verification on a busy round. |
| P1 | Full x402 client loop (`client/`) | `reference-implementation/client/src/test-router-task.ts` | Rewritten for the `@x402/*` package family (different from `reference-implementation`'s `@x402-avm/*`). Run live against research agent: `402` → signed retry → correctly rejected `insufficient balance`. |
| P2 | Real research agent (Groq findings) | `reference-implementation`'s Groq analysis pattern | Tested directly: 5 real, relevant findings with source attribution |
| P2 | Real writer agent (Groq synthesis) | same | Tested directly: coherent summary synthesizing findings |
| P2 | Real formatter agent (live currency conversion, SVG) | `reference-implementation/server/src/agents/currencyAgent.ts` | Tested directly: correct live FX rates, correct SVG. Replaced a formatter that rendered a meaningless bar chart of *per-line character counts* — real value now. |
| P4 | No-payment preview mode (`/debug/preview`, on each agent + router) | `reference-implementation`'s "Preview (no payment)" button | Tested live end-to-end through the router: real 3-agent pipeline, zero payment |
| — | Routing fee (5th leg in the settlement group) | (new, not from either repo — the analysis doc's recommendation) | Verified live in logs: `3 payout(s) + 1 routing fee + 1 fee-payer txn` |
| P3 | Groq-based dynamic agent selection (`router/selectAgents.ts`) | `reference-implementation`'s `llmExtractor.ts` pattern | Verified live: "Explain how Algorand consensus works" → QUOTE selects `[research, writer]` only, total $0.05, group size 4. "Convert 250 USD to EUR..." → selects all three, total $0.06, group size 5. Falls back to all three on any Groq failure. |
| — | "Preview (no payment)" button actually wired into the dashboard UI | (bug found in `BV_UncZ` itself) | The `/debug/preview` route existed but nothing in `ui/index.html` called it — the button in this table's earlier version was never real. Now wired up and tested live in-browser. |

**`MOCK=true` is still fully wired** on research/writer as a working fallback — flip one env
var if Groq or wifi is unreliable during the actual demo. Never mocks payment, only content.

## What's NOT been ported (and shouldn't be, carelessly)

- Package versions / the `@x402-avm/*` family / `paymentMiddlewareFromConfig` — mixing
  package families reintroduces the exact CAIP-2 truncation bug both `docs/PROBLEMS.md`
  files independently document. `BV_UncZ` stays on `@x402/*@2.12.0`, pinned exact, no carets.
- `reference-implementation`'s single-endpoint routing model — not applicable, `BV_UncZ`'s
  whole point is multi-party atomic settlement, not one bundled payment.

---

## 6. What's still left

**From the analysis doc's plan, not yet done:**
- **One novelty feature** (pick at most one, per the doc): a judge-triggerable replay
  self-test endpoint, a spend-mandate on top of the per-request budget cap, or a
  pre-settlement quality gate (validate agents before paying them, not just that they're
  alive). The doc rates the quality gate as the strongest single move, but also the most
  expensive (~30 min).

**The one blocker underneath all of it:** every wallet (`USER`, `ROUTER`, `ROUTER_FEE`,
`AGENT1-3`) is funded with ALGO and opted into the USDC ASA — but **none of them has actual
USDC**. Every settlement attempt has been proven correct right up to
`underflow on subtracting N from sender amount 0` — the group builds, signs, and submits
for real, it just can't move funds that don't exist. This has been the dominant time sink
of the entire project (see both `PROBLEMS.md` files for the full faucet saga). Until real
testnet USDC lands in `ROUTER_ADDR`, we don't have the single most important artifact for
the PPT: a real, confirmed, explorer-verifiable group ID.

**Not yet done at all:** demo rehearsal, PPT slides, the fresh-clone integration test.

---

## 7. Running it yourself

```bash
cd BV_UncZ
npm install
cd pera_wallet_setup/scripts && npm install && cd ../..
# .env.wallets at BV_UncZ root needs USER/ROUTER/ROUTER_FEE/AGENT1/AGENT2/AGENT3 _ADDR + _MNEMONIC
# + GROQ_API_KEY (router/selectAgents.ts and the research/writer agents all use it;
#   router falls back to quoting all 3 agents if it's missing, so this is optional but recommended)
npm run dev:research    # port 4001
npm run dev:writer      # port 4002
npm run dev:formatter   # port 4003
npm run dev:router      # port 4000 — dashboard at http://localhost:4000
```

Try it without any payment at all (real agent logic, zero funds needed) — either click
**"Preview (no payment)"** on the dashboard at `http://localhost:4000`, or:
```bash
curl -X POST http://localhost:4000/debug/preview -H "Content-Type: application/json" \
  -d '{"task":"why atomic transaction groups matter"}'
```

Try the real thing (will `402` until wallets have USDC):
```bash
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"test","maxSpend":0.10}'
```

Full x402 client loop against one agent directly:
```bash
cd BV_UncZ/client && npm run test:agent -- http://localhost:4001/work
```

See `BV_UncZ/docs/PROBLEMS.md` and `reference-implementation/docs/PROBLEMS.md` for every
real bug either of us hit, with root cause and fix — worth reading before you hit the same
one twice.
