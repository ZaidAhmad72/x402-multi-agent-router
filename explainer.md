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

- **Rohan** built `BV_UncZ/` — several separately-paid agents, fanned in through one real
  atomic settlement group. This is the actual PS0404 submission.
- **Zaid** built `reference-implementation/` — one payment-gated endpoint that bundles
  three services behind a single $0.01 payment. No atomic group anywhere in it (confirmed
  by grepping the codebase — zero hits for "group"/"atomic"/"newGroup"). This is closer to
  a different problem statement (PS0401-shaped: one paid endpoint, not multi-party atomic
  payment).

**Decision: `BV_UncZ/` is the submission.** It's the only one of the two that actually does
what PS0404 asks. `reference-implementation/` is kept in the repo because several of its
pieces are genuinely better than what `BV_UncZ/` had and have been ported over — see §7.

---

## 3. Architecture — how `BV_UncZ/` actually works

Four phases, one HTTP call (`POST /route`) driving all of them:

```
USER              ROUTER                 AGENTS              ALGORAND
 │                  │                       │                    │
 │─ task+budget ───>│                       │                    │
 │                  │  QUALITY: trial-run selected agents free   │
 │                  │  via /debug/preview, Groq judges each      │
 │                  │  output. Any reject → abort, zero spend.   │
 │                  │── POST /work (Nx) ───>│  no payment header │
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

**QUALITY** (`router/qualityGate.ts`) — runs first, before anything payment-related. Trial-runs
every agent the task needs through its free, unprotected `/debug/preview` route, then asks a
Groq judge whether each output is genuinely relevant and substantive. Any rejection aborts
the whole route right here — the agents haven't even been asked for a price yet.

**QUOTE** (`router/quote.ts`) — hits every selected agent's `/work` with no payment header,
expects `402` from each, decodes the price/payTo from each, sums to a total. If any agent
doesn't challenge (dead, misconfigured), the whole thing throws here — **before any money
moves.**

**SETTLE** (`router/settle.ts`) — the core novelty. Two gates run before any signing:
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

### What the user actually sees

Open `http://localhost:4000` and there's one page: a task box, a max-spend box, three
one-click example-task buttons (General / Currency / Weather + currency — see §13), a
**Route** button and a **Preview (no payment)** button, and a phase tracker (QUALITY →
QUOTE → SETTLE → REDEEM). Once something runs, panels appear below it: a per-agent
quality-verdict table, a settlement panel with a clickable group-ID/explorer link, a
paid/slashed receipt table, and each agent's actual output (findings, a written summary,
a currency chart, a weather reading, or a narrative — whichever agents ran). Further
down: a live wallet-balance table and three demo panels (kill switch, quality-gate
override, self-test replay).

Type a task, click **Route**, and the four phase boxes light up green (or red, wherever
it stopped) in real time as the request actually works through QUALITY → QUOTE → SETTLE
→ REDEEM against the live backend. Nothing on this page is mocked or simulated when you
click Route — every button fires a real HTTP call to the router, which fires real HTTP
calls to real agent processes and a real Algorand testnet transaction.

### Roles — Algorand, wallets, x402, agents, router

For anyone new to any one of these pieces:

- **Algorand** is the blockchain — a shared, public ledger that the router, every agent,
  and anyone holding an explorer link can all independently check. It's what makes
  "everyone got paid, or nobody did" a fact enforced by consensus, not a claim you have
  to trust the router on. Its **atomic transaction group** feature (up to 16 transactions
  that commit or fail together, no smart contract needed) is the one primitive this
  entire project is built on.
- A **wallet** is just a public address plus a private key. The address is where money
  can be sent; the private key is what proves you're allowed to spend from it, by
  signing a transaction. Every party here — the router, each agent, the routing-fee
  treasury, the stake pool — has its own separate wallet. All of them hold **testnet**
  ALGO/USDC, worth nothing real (see the note near the bottom of the README).
- **x402** is the actual web standard being demonstrated: the HTTP `402 Payment
  Required` status code, extended with a header describing exactly what to pay and
  where. A resource challenges with `402`; the payer signs a payment matching that
  challenge, retries, and gets the real response. Every agent here speaks this protocol
  natively (via the `@x402/*` packages) — the router's QUOTE phase is literally
  "collect everyone's `402` challenge," and REDEEM is "prove the challenge was met."
  Right now the *router itself* plays the paying party in that exchange (see §4) — a
  real end user speaking x402 directly to an agent is proven separately in `client/`,
  just not wired to the dashboard's Route button yet.
- The **agents** are the actual paid workers — five small, independent services, each
  its own process, port, wallet, and price, each doing one real, different job:

  | Agent | Price | Does | How |
  |---|---|---|---|
  | research | $0.03 | gathers sourced findings on a topic | Groq (LLM) |
  | writer | $0.02 | turns findings into a written summary | Groq (LLM) |
  | formatter | $0.01 | converts an amount into other currencies, renders a chart | deterministic — live FX API, static fallback if it's down |
  | weather | $0.02 | live current weather for a city | deterministic — live Open-Meteo API, static fallback if it's down |
  | analysis | $0.02 | synthesizes weather and/or currency results into a narrative | Groq (LLM) |

  They know nothing about each other or about the router beyond one HTTP call each; the
  router is the only thing that ever sees the full picture. Which subset of the five
  actually runs is decided per task by `router/selectAgents.ts` (a Groq call, see §7's
  P3 row) — see §13 for the two newest agents and the selection bugs found while adding them.
- The **router** is the orchestrator — the only piece that talks to everyone. It never
  does any of the actual work itself; its whole job is deciding which agents a task
  needs, running the quality check, collecting their prices, building and signing the
  one atomic payment, then collecting their results and handing back one combined
  answer plus one group ID.

---

## 4. How payment actually works, from a user's perspective — read this carefully

This is the part that's easy to assume wrong, so spelling it out plainly:

**Right now, the person clicking "Route" on the dashboard never signs anything and never
connects a wallet.** The router pays all the agents itself, out of its own pre-funded
treasury wallet (`ROUTER_ADDR` — genuinely funded as of §12). From the user's point of
view, it looks like: type a task, click a button, get a real result and a real group ID.
There is no "approve this payment" prompt in that flow today.

That's *not* an oversight — it matches how `BV_UncZ` was scoped: the interesting, novel part
of this project is the **outbound leg** (router → N agents, atomically), and that's fully
built and it's what QUOTE/SETTLE/REDEEM above describes. The **inbound leg** (the actual
end-user paying the router via the standard x402 challenge-and-sign flow) is a separate,
well-understood piece of the protocol — and it's proven to work, just not wired into the
dashboard yet. Proof: `BV_UncZ/client/` is a standalone script that runs that exact flow for
real — call an agent with no payment, get a `402`, sign a payment, retry, get a `200`. Try it:

```bash
cd BV_UncZ/client && npm run test:agent -- http://localhost:4001/work
```

**So "add actual payment" (the next milestone) specifically means:** wiring that same
challenge-and-sign flow onto the *front* of `/route`, so it's the end user's own wallet
paying the router (or, in a stretch version, paying the agents directly), instead of the
router spending from a pre-funded treasury. Until then, everything downstream of that step —
the atomic group, the on-chain verification, the replay guard, the quality gate — is real and
already proven; only the very first hop (who signs the very first payment) is still the
router's own wallet standing in for the user.

---

## 5. Folder structure

```
x402/
├── README.md                      ← repo overview, points here for detail
├── explainer.md                   ← this file
├── BV_UncZ/                       ← THE SUBMISSION
│   ├── CLAUDE.md                  ← Rohan's original spec/working agreement (unedited)
│   ├── README.md                  ← BV_UncZ's own architecture doc
│   ├── docs/PROBLEMS.md           ← every real bug hit building BV_UncZ, root cause + fix
│   ├── .env.wallets                ← gitignored — USER/ROUTER/ROUTER_FEE/AGENT1-5/
│   │                                  STAKE_FORMATTER wallets
│   ├── shared/                    ← constants (CAIP-2, ASA ID, routing fee, AGENT_REGISTRY),
│   │                                 types, replayGuard, verifyPayment (agent-side check)
│   ├── agents/
│   │   ├── research/  (port 4001, $0.03) — real Groq findings
│   │   ├── writer/    (port 4002, $0.02) — real Groq synthesis of research's findings
│   │   ├── formatter/ (port 4003, $0.01) — real live currency conversion, NO LLM (hard
│   │   │                                    requirement — heterogeneity is judged)
│   │   ├── weather/   (port 4004, $0.02) — real live weather lookup, NO LLM
│   │   └── analysis/  (port 4005, $0.02) — real Groq synthesis of weather/currency data
│   ├── router/         ← index.ts (Hono app), qualityGate.ts, stake.ts, quote.ts, settle.ts,
│   │                      redeem.ts, selectAgents.ts, selfTestReplay.ts, balances.ts,
│   │                      debugPreview.ts, previewCall.ts (shared no-payment call helper)
│   ├── client/          ← standalone x402 client loop: unpaid → 402 → signed retry → 200
│   │                       + decoded settlement receipt, run directly against one agent
│   ├── ui/               ← dashboard, served by the router itself at :4000
│   └── pera_wallet_setup/scripts/ ← generate-wallets, check-balance, opt-in-usdc, seed-stake,
│                                     add-agent-wallet, fund-and-optin-agent, fund-stake-usdc
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

## 6. Adding a new agent — the registry is pluggable

`shared/constants.ts`'s `AGENT_REGISTRY` is the single source of truth for which agents
exist. Every part of the router — quoting, settling, redeeming, the quality gate, dynamic
agent selection, and the dashboard UI — reads this list; **none of them hardcode agent
names.** To add another agent:

1. Build its service under `agents/<name>/` — same shape as the existing ones: its own
   port, its own wallet, a price, an x402-gated `POST /work`, a `POST /redeem` that verifies
   on-chain, and an unprotected `POST /debug/preview` for the quality gate and demo mode.
2. Add its wallet address + mnemonic to `.env.wallets` (`pera_wallet_setup/scripts/add-agent-wallet.ts`
   generates one; `fund-and-optin-agent.ts` funds it with ALGO from the router and opts it into USDC).
3. Add one entry to `AGENT_REGISTRY`:
   ```ts
   {
     name: 'translator',
     url: 'http://localhost:4006',
     description: 'translates text into another language. Needed when the task asks for a translation.',
     dependsOn: ['writer'],                              // optional — auto-included when this agent is
     buildInput: (task, outputs) => ({ text: outputs.writer?.summary?.body ?? task }),
   }
   ```
   `description` is what the Groq agent-selector reads to decide when this agent is relevant
   (keep it purely descriptive — it's also fed to the quality judge, see §13's second bug).
   `dependsOn` names other agents whose output this one needs — selecting this agent
   automatically pulls in its dependencies too. `buildInput` builds this agent's request body
   from the task and every prior agent's output (keyed by name).

That's it — `quote.ts`/`settle.ts` already loop over whatever registry they're given,
`redeem.ts` and `debugPreview.ts` walk the registry in order calling each `buildInput`, and
the dashboard fetches `GET /agents` on load instead of hardcoding names, so the kill-switch
panel, self-test replay panel, and result rendering pick up the new agent automatically too.

**This is not theoretical** — §13 is exactly this process followed twice in a row (weather,
analysis), with zero changes needed to any of the files above.

---

## 7. What's been merged from `reference-implementation/` into `BV_UncZ/`

Everything below is **done, verified live, committed, and pushed**:

| # | What | From | Verified how |
|---|---|---|---|
| — | `intra-round-offset` bug fix | (bug found in `BV_UncZ` itself) | Was trusted as group-relative; it's round-relative. Now sorted+indexed by position. Would've silently broken redeem verification on a busy round. |
| P1 | Full x402 client loop (`client/`) | `reference-implementation/client/src/test-router-task.ts` | Rewritten for the `@x402/*` package family (different from `reference-implementation`'s `@x402-avm/*`). Run live against research agent: `402` → signed retry → correctly rejected `insufficient balance`. |
| P2 | Real research agent (Groq findings) | `reference-implementation`'s Groq analysis pattern | Tested directly: 5 real, relevant findings with source attribution |
| P2 | Real writer agent (Groq synthesis) | same | Tested directly: coherent summary synthesizing findings |
| P2 | Real formatter agent (live currency conversion, SVG) | `reference-implementation/server/src/agents/currencyAgent.ts` | Tested directly: correct live FX rates, correct SVG. Replaced a formatter that rendered a meaningless bar chart of *per-line character counts* — real value now. |
| P2 | Real weather agent (live Open-Meteo lookup) | `reference-implementation/server/src/agents/weatherAgent.ts` | Ported near-verbatim (location extraction + geocoding + forecast lookup). Tested directly and through a real settlement: real temperature/wind/condition for named cities. See §13. |
| — | Analysis agent (weather/currency narrative synthesis) | Fills `reference-implementation/server/src/agents/analysisAgent.ts`'s role | New code (currency itself was already covered by formatter — see P2 above), same idea: Groq ties together whatever domain data ran into a short narrative. Tested directly and through a real settlement. See §13. |
| P4 | No-payment preview mode (`/debug/preview`, on each agent + router) | `reference-implementation`'s "Preview (no payment)" button | Tested live end-to-end through the router: real N-agent pipeline, zero payment |
| — | Routing fee (5th leg in the settlement group) | (new, not from either repo — the analysis doc's recommendation) | Verified live in logs: `3 payout(s) + 1 routing fee + 1 fee-payer txn` |
| P3 | Groq-based dynamic agent selection (`router/selectAgents.ts`) | `reference-implementation`'s `llmExtractor.ts` pattern | Verified live across 5 agents now — see §13 for the latest numbers. |
| — | "Preview (no payment)" button actually wired into the dashboard UI | (bug found in `BV_UncZ` itself) | The `/debug/preview` route existed but nothing in `ui/index.html` called it. Now wired up and tested live in-browser. |

**`MOCK=true` is still fully wired** on research/writer/analysis as a working fallback — flip
one env var if Groq or wifi is unreliable during the actual demo. Never mocks payment, only content.

### What's NOT been ported (and shouldn't be, carelessly)

- Package versions / the `@x402-avm/*` family / `paymentMiddlewareFromConfig` — mixing
  package families reintroduces the exact CAIP-2 truncation bug both `docs/PROBLEMS.md`
  files independently document. `BV_UncZ` stays on `@x402/*@2.12.0`, pinned exact, no carets.
- `reference-implementation`'s single-endpoint routing model — not applicable, `BV_UncZ`'s
  whole point is multi-party atomic settlement, not one bundled payment.

---

## 8. Novelty feature: the pre-settlement quality gate

Picked from the analysis doc's shortlist (it rated this the strongest single move). Built as
`router/qualityGate.ts`, running as its own phase before QUOTE (see the diagram in §3).

**What it actually does:** for every agent the task selected, call its free `/debug/preview`
route (same one the demo "Preview" button uses) to get a real trial output at zero cost, then
send that output to a Groq judge — scoped to that agent's own job (see §13's bug #2) — with
the prompt "is this genuinely relevant and substantive for *your* part of the task, or not?"
A rejection either **slashes** that agent (if it has a stake configured — see §9) or **aborts
the entire route** (if it doesn't) — `phase: "QUALITY"`, `zeroSpend: true` — before any agent
is even asked for a price, let alone paid.

**Fails open, on purpose:** if `GROQ_API_KEY` is missing or the Groq call errors, the gate
lets the request through rather than blocking the whole product on an LLM outage — same
policy as `selectAgents.ts`. This is a real limitation worth saying out loud to judges if
asked: the gate is a genuine safety net, not a guarantee, and it degrades gracefully rather
than failing closed.

**Demo/testing overrides:** relying on a live LLM to reliably reject on command during a demo
is risky, so there are two manual levers, same idea as the agent kill switch:

```bash
# Global — every agent gets the same forced verdict
curl -X POST http://localhost:4000/admin/quality-gate/fail   # force every agent to be rejected
curl -X POST http://localhost:4000/admin/quality-gate/pass   # force every agent to pass, skip the judge
curl -X POST http://localhost:4000/admin/quality-gate/auto   # back to the real Groq judge (default)

# Targeted — force exactly one named agent to fail, everyone else still runs the real judge.
# This is the one to use for demoing the slash specifically (see §9) — a global force-fail
# would also fail research/writer, which have no stake and would abort the whole route instead.
curl -X POST http://localhost:4000/admin/quality-gate/target/formatter
curl -X POST http://localhost:4000/admin/quality-gate/target-clear   # reset when done
```
Matching buttons are on the dashboard under "Demo quality gate override."

---

## 9. Novelty feature: stake + slash — accountability, not just liveness

The quality gate on its own can only do one thing with a bad output: refuse to pay anyone and
abort. That's a real guarantee (the project's original liveness gate does the same for a dead
agent), but it doesn't distinguish "this agent is down" from "this agent responded with
garbage" — both just mean nobody gets paid. Stake + slash adds a second, sharper outcome for
the second case: **the offending agent gets nothing, and the user gets a rebate, in the same
atomic group** — instead of the whole job just failing.

**How it works, mechanically:**
- One agent (`formatter`, chosen as the simplest/fastest to demo) has a dedicated **stake
  wallet** that the router holds signing authority over — funded once, out of band, via
  `pera_wallet_setup/scripts/seed-stake.ts` (never live in the router itself).
- If `formatter`'s quality verdict fails, `router/settle.ts` swaps its normal payout leg
  (`router → formatter`) for a **slash leg** (`stake wallet → user`) in the exact same
  transaction slot, in the exact same atomic group. Same group, same one-shot commitment —
  just a different destination for that one leg, decided by the quality verdict computed
  *before* the group is even built (see §8 — this is only possible because quality is checked
  against a free trial run before payment, avoiding the "pay-then-get-work" ordering problem
  entirely).
- An agent that fails and has **no** stake configured still aborts the whole route — the old,
  simpler guarantee is the fallback when there's no financial accountability to reach for.

**Verified live, for real, on-chain** (as of §12's funding, this now actually settles instead
of just composing/signing): targeting formatter to fail on a currency task produces research
and writer passing the real Groq judge, formatter correctly marked `staked: true` and
rejected, `router.out.log` showing —

```
SETTLE — building one atomic group: 2 payout(s) + 1 slash(es) + 1 routing fee + 1 fee-payer txn
```

— and a real settled group with formatter's outcome `"slashed"`, a real 0.5 USDC rebate txId
landing at the user's address, while research/writer show `"paid"` in the same group.

**The receipt** (`POST /route`'s JSON response, and the dashboard's "Receipt" panel) makes
the outcome explicit per agent, not just a settled/not-settled flag:
```json
{
  "receipt": [
    { "agent": "research", "outcome": "paid", "amountUsd": 0.03 },
    { "agent": "writer", "outcome": "paid", "amountUsd": 0.02 },
    { "agent": "formatter", "outcome": "slashed", "amountUsd": 0.5, "rebateToUser": "<addr>", "reason": "..." }
  ]
}
```

**Extending to another agent:** add `STAKE_<NAME>_ADDR` / `STAKE_<NAME>_MNEMONIC` to
`.env.wallets` (run `seed-stake.ts <NAME>` to generate+fund+opt-in one) — `router/stake.ts`
picks it up automatically, no code changes needed. Slash amount (`SLASH_AMOUNT_MICRO_USDC` in
`stake.ts`) is currently fixed at 0.5 USDC, deliberately decoupled from the agent's quoted
price — it's an accountability penalty, not a fee refund.

---

## 10. Novelty feature: self-test replay endpoint

Judge-triggerable proof that the replay guard (`shared/replayGuard.ts`) actually does what the
README claims, instead of asking judges to take it on faith. `router/selfTestReplay.ts` fires
N concurrent `/redeem` calls at one real, running agent, all carrying the *exact same*
`X-PAYMENT-GROUP` / `X-PAYMENT-INDEX` pair, and reports how many got through.

```bash
curl -X POST http://localhost:4000/self-test/replay -H "Content-Type: application/json" \
  -d '{"agent":"research","n":6}'
```
Verified live: 6 concurrent identical requests → exactly 1 passed the guard (and correctly
went on to fail payment verification, since the test uses a synthetic group ID with no real
payment behind it — a separate, already-proven concern) and 5 were rejected with `409 replay
rejected`. This is a real race against the actual in-memory guard in the actual agent
process — not simulated — because the guard's `Map` check runs synchronously before any
`await`, so Node's single-threaded event loop serializes concurrent hits on the same key
regardless of how close together the HTTP requests arrive. Also on the dashboard, under
"Self-test: replay guard" — works against any of the five agents.

---

## 11. One item from the latest plan that doesn't apply here — flagging rather than forcing it

The plan's "Hour 0–1: de-risk the integration point" step (stub an organizer-provided
settlement API behind a mock, so the rest of the flow can be proven without it) assumes a
different architecture than ours: a project that calls out to an **organizer-supplied
settlement endpoint**. `BV_UncZ` doesn't have one — it settles directly against Algorand via
`@algorandfoundation/algokit-utils`'s `AtomicTransactionComposer`, with no third-party API in
the loop at all. There's nothing to stub; the real settlement code already exists and has been
exercised end-to-end (see §12) — its only remaining dependency is real testnet USDC, not an
external API. Skipping this step rather than building a stub for an integration point that
doesn't exist in this codebase.

The plan's "Hour 4–4.5: explorer deep-link" was already done before this plan arrived —
`settlement.explorerUrl` (`shared/constants.ts`'s `explorerGroupUrl()`) has been in every
settlement response since the original build, and the dashboard renders it as a clickable link
in the "Settlement" panel.

---

## 12. The funding blocker is RESOLVED — real, on-chain proof

**2026-08-12:** a teammate supplied a wallet already holding ~19.86 real testnet USDC. Swapped
into `ROUTER_ADDR`/`ROUTER_MNEMONIC` in `.env.wallets` (gitignored, not in this repo), verified
its balance live via algod *before* swapping it in. This was the single dominant blocker for
the entire project (see both `PROBLEMS.md` files for the faucet saga that preceded this) — it
is no longer a blocker. Several real settlements have run since, back to back, including:

| Task | Agents paid | Outcome | Group ID / round |
|---|---|---|---|
| "Summarize algorand x402 atomic groups..." | research, writer | both `paid` | `2o9GZEbH5hdYat/trOYW01qVR1l2a21w+rIAdvmLtsE=`, round 66237349 |
| "Convert 250 USD to EUR" | research, writer, formatter | all `paid` | `VTvBIHhE1Vn/slppARJbOKuHO3q74SR/2h6NLlGeBKI=`, round 66237361 |
| "Convert 250 USD to EUR" (formatter forced to fail) | research/writer `paid`, **formatter `slashed`** | 0.5 USDC rebate to the user, on-chain txId `C2UZ53WNFINFHE7OXAVR7WPC5TFTWUGJXYHOXCIOYSYUQASLY6KA` | `Z9jaMck6ajo8M2N7TPAryPAOvXu7pSRQNT+MDhWln+M=`, round 66237390 |
| "whats the weather in tokyo" | weather, analysis | both `paid` | `70dAUELG7paB5iwy4RtE44x84AcJDFGfcedMK0y5kTQ=`, round 66238655 |
| "whats the weather in berlin and convert 100 usd to eur" | all 5 agents | all `paid` | `q2KxwGZuv9rvUZg7o682kjJTbf8tYdubegzJHxSwTw0=`, round 66240623 |

Each: `curl` the explorer URL pattern `https://lora.algokit.io/testnet/block/<round>/group/<url-encoded-groupId>` — every one resolves to a real, multi-transaction Algorand testnet group. Balances were checked before and after each call via `GET /balances` and moved by exactly the expected amounts — no discrepancy. The stake+slash row is the actual "money shot" (§9) — not just composed and signed, **settled**, with the agent paid nothing and the user's stake-funded rebate confirmed on-chain.

The stake wallet and the two new agent wallets (weather, analysis) were funded the same way —
small amounts sent from the now-flush router wallet via one-off scripts
(`fund-stake-usdc.ts`, `fund-and-optin-agent.ts`), never part of the live router.

**What this changes for the PPT:** we now have exactly the artifact that was missing for
months of this project's timeline — a real, confirmed, explorer-verifiable group ID, for the
plain multi-agent payout case, the stake+slash case, and the weather-agent case. Screenshot
the explorer pages before the demo in case testnet is flaky on the day.

**A concrete reason to take that last sentence seriously:** at more than one point during this
session, `testnet-api.algonode.cloud` and/or `testnet-idx.algonode.cloud` started timing out
or refusing connections entirely — confirmed from the router's own host machine (not a tooling
artifact), general internet unaffected, only those specific hosts, and it recovered on its own
each time within roughly half an hour. `GET /balances` silently shows every wallet as `0`/`0`
during an outage like this (`balances.ts` fails open to zero on any fetch error) — **that is
not the same as the funds being gone.** A REDEEM step can also fail this way even after a
successful SETTLE (`router/index.ts`'s `phase: "SETTLED", settledButNotRedeemed: true`
response) — money already moved for real, only the post-payment on-chain verification hit the
outage. The group IDs above and the confirmed on-chain txIds inside them are the actual source
of truth; re-check via the explorer links once connectivity recovers, don't trust a zero
balance or a redeem failure alone. Worth a `check-balance.ts` run right before walking on
stage, not relying on a `/balances` snapshot from earlier in the day.

---

## 13. Weather + analysis agents — restoring the full weather/currency/analysis trio

Zaid's original `reference-implementation/` had three domain agents: weather, currency,
analysis. `BV_UncZ`'s formatter already covers currency (see §7), so completing the trio
meant adding two more agents to the registry: **weather** (port 4004, $0.02) and
**analysis** (port 4005, $0.02).

**weather** ports `reference-implementation/server/src/agents/weatherAgent.ts` almost
verbatim — deterministic, no LLM, a naive-but-effective location extractor plus a live
Open-Meteo lookup. Same resilience pattern already applied to formatter: if Open-Meteo
is unreachable, it falls back to a small static table for a handful of major cities,
clearly marked `"live": false` rather than silently passing off stale data as current.

**analysis** is new code filling the role `reference-implementation`'s `analysisAgent.ts`
played — a Groq call that ties together whatever weather and/or currency data actually ran
into a short plain-language narrative. It reads from the outputs of whichever agents ran
before it (`outputs.weather`, `outputs.formatter`), so it works whether the task involved
just weather, just currency, or both.

The dashboard now has three one-click example-task buttons — **General**, **Currency**,
**Weather + currency** — so this is a real, selectable alternative task type, not a hidden
capability: pick between the original atomic-group demo task and a weather-flavored one.

**This was the first real test of the pluggable registry built in §6, and it held up: the two
new agents needed zero changes anywhere else.** `quote.ts`, `settle.ts`, `redeem.ts`,
`debugPreview.ts`, the kill switch, and self-test replay all picked them up automatically
through `AGENT_REGISTRY`. The dashboard discovered them via `GET /agents` without a UI change.

**Three real bugs surfaced by combining weather + currency in one task, live, and fixed:**

1. **formatter's amount parsing grabbed the wrong number.** Its regex took the first digit
   sequence anywhere in its input text. When formatter's input is writer's summary (which
   might now mention a temperature *before* the dollar amount — "...temperatures ranging
   from 1°C to 23°C... 100 USD is approximately..."), it parsed `1` instead of `100`. Fixed
   to prefer a number immediately adjacent to a currency word, only falling back to "first
   number anywhere" if no currency-adjacent match exists.
2. **The quality judge scored each agent against the whole task, not its own job.** A
   compound task like "weather in Berlin and convert 100 USD to EUR" made the judge
   penalize the weather agent for "missing currency conversion" — a job it was never
   supposed to do. Fixed by passing each agent's own registry `description` into the judge
   prompt and explicitly telling it not to penalize an agent for parts of the task other
   agents handle.
3. **The agent selector redundantly included research+writer alongside the specialized
   agents** that already fully covered the task, wasting money on overlapping coverage.
   Fixed with an explicit rule in `selectAgents.ts`'s system prompt: prefer a specific
   agent over the general research/writer pair when the specific one already covers that
   part of the task. Deliberately *not* fixed by adding exclusion language to research's
   own `description` — that field is also fed to the judge, and negative/exclusionary
   phrasing there got misread as a quality criterion, which is what caused bug 2's sibling
   failure mode in the first place. Lesson: keep agent descriptions purely descriptive;
   put selection *rules* in the selector's own prompt, not in individual agents' text.

**Verified live, real settlements, after all three fixes** — see the last two rows of §12's
table: a pure weather task correctly selects just weather+analysis (2 agents, cheaper), and a
combined weather+currency task settles cleanly with all 5 agents, every one `paid`.

---

## 14. What's still left

**Next milestone, not yet started:** wiring the actual end-user-facing x402 payment flow onto
the front of `/route` (see §4) — today the router pays from its own pre-funded wallet (now
genuinely funded, see §12); `client/` already proves the real challenge-and-sign mechanics
work, it just isn't hooked up to the dashboard's "Route" button yet.

**Not yet done at all:** demo rehearsal, PPT slides, the fresh-clone integration test.

---

## 15. How to test the different scenarios

As of §12, `ROUTER_ADDR` is genuinely funded, so the normal-task case below now actually
settles for real. Every other case here still needs no funds at all — they fail (correctly)
*before* the SETTLE phase, which is the only step that ever needed money.

**Normal task, everything healthy:**
```bash
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"Explain how Algorand consensus works","maxSpend":0.10}'
```
Expect: `phase: "REDEEMED"`, a real `settlement.groupId` + `explorerUrl`, and every agent in
`receipt` marked `"outcome":"paid"` — a real, complete, on-chain settlement (see §12 for
already-captured examples). If your own `.env.wallets` isn't funded, this instead fails
cleanly at SETTLE with a clear "router wallet needs funding" message — still proves everything
up to that point works.

**A weather task (the new example)** — try `whats the weather in tokyo` or click the
**"Weather + currency"** example button on the dashboard for the combined version.

**"Not good enough answer → no payment" (the quality gate rejecting):**
```bash
curl -X POST http://localhost:4000/admin/quality-gate/fail
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"Explain how Algorand consensus works","maxSpend":0.10}'
curl -X POST http://localhost:4000/admin/quality-gate/auto   # reset when done
```
Expect: `phase: "QUALITY"`, `zeroSpend: true`, and the response never reaches QUOTE — no
agent is even challenged for a price.

**"2 agents work, 1 fails" (an agent going down mid-flow):**
```bash
curl -X POST http://localhost:4000/admin/kill/writer
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"Explain how Algorand consensus works","maxSpend":0.10}'
curl -X POST http://localhost:4000/admin/revive/writer   # reset when done
```
Expect: QUALITY passes (the trial `/debug/preview` call isn't kill-switch-gated — only the
paid `/work` and `/redeem` routes are), then QUOTE fails with a liveness error naming the
dead agent, `zeroSpend: true`. This is the project's core liveness guarantee: a dead agent is
caught *before* the group is ever built, never as a partial payment.

**Budget too low (would exceed `maxSpend`):**
```bash
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"Convert 250 USD to EUR and explain the trend","maxSpend":0.01}'
```
Expect: `BudgetExceededError` — total quoted cost exceeds the $0.01 cap. Nothing is ever signed.

**Task-dependent agent selection (fewer agents quoted when fewer are needed):**
```bash
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"whats the weather in tokyo","maxSpend":0.10}'                    # weather only → 2 agents, $0.04
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"Convert 250 USD to EUR","maxSpend":0.10}'                        # currency → 3 agents, $0.06
```
Check `router.out.log` (or the terminal running `npm run dev:router`) for the `agent
selection: [...]` line and the QUOTE total to see N actually change per request.

**Stake + slash, isolated to just the staked agent** (the "bad answer → agent gets nothing,
user gets rebated" case, distinct from the plain abort-everything case above):
```bash
curl -X POST http://localhost:4000/admin/quality-gate/target/formatter
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"Convert 250 USD to EUR","maxSpend":0.10}'
curl -X POST http://localhost:4000/admin/quality-gate/target-clear   # reset when done
```
Expect: `qualityVerdicts` shows research/writer passing (real judge) and formatter failing
with `staked: true`. The route does **not** abort — it proceeds into QUOTE and SETTLE, and
`receipt` shows research/writer `"paid"` and formatter `"slashed"` with a real `rebateToUser`
— this exact sequence is how the real slash in §9/§12 was captured.

**Self-test the replay guard** (no group/task needed at all):
```bash
curl -X POST http://localhost:4000/self-test/replay -H "Content-Type: application/json" \
  -d '{"agent":"research","n":6}'
```
Expect: `passedGuard: 1`, `replayRejected: 5` (or whatever `n` you pick, always exactly 1
passing). See §10 for what the numbers mean.

**All of the above work identically from the dashboard** — the phase boxes (QUALITY → QUOTE →
SETTLE → REDEEM) turn red at whichever step failed, with the same error text, and the
"Quality gate results" / "Receipt" panels show the per-agent detail live.

---

## 16. Running it yourself

```bash
cd BV_UncZ
npm install
cd pera_wallet_setup/scripts && npm install && cd ../..
# .env.wallets at BV_UncZ root needs USER/ROUTER/ROUTER_FEE/AGENT1-5 _ADDR + _MNEMONIC
# + GROQ_API_KEY (used by router/selectAgents.ts, router/qualityGate.ts, and the
#   research/writer/analysis agents; router falls back to safe defaults if it's missing —
#   optional but recommended)
npm run dev:research    # port 4001
npm run dev:writer      # port 4002
npm run dev:formatter   # port 4003
npm run dev:weather     # port 4004
npm run dev:analysis    # port 4005
npm run dev:router      # port 4000 — dashboard at http://localhost:4000
```

Try it without any payment at all (real agent logic, zero funds needed) — either click
**"Preview (no payment)"** on the dashboard at `http://localhost:4000`, or:
```bash
curl -X POST http://localhost:4000/debug/preview -H "Content-Type: application/json" \
  -d '{"task":"why atomic transaction groups matter"}'
```

Try the real thing — as of §12, `ROUTER_ADDR` is genuinely funded, so this now actually settles:
```bash
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"test","maxSpend":0.10}'
```
If your own `.env.wallets` doesn't have a funded `ROUTER_ADDR` yet, this will still fail
cleanly with a clear "needs funding" message instead of a generic error — see §12 for how we
got ours funded.

Full x402 client loop against one agent directly (the real payment mechanics, proven — see §4):
```bash
cd BV_UncZ/client && npm run test:agent -- http://localhost:4001/work
```

See `BV_UncZ/docs/PROBLEMS.md` and `reference-implementation/docs/PROBLEMS.md` for every
real bug either of us hit, with root cause and fix — worth reading before you hit the same
one twice.
