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
pieces are genuinely better than what `BV_UncZ/` had and have been ported over — see §6.

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

---

## 4. How payment actually works, from a user's perspective — read this carefully

This is the part that's easy to assume wrong, so spelling it out plainly:

**Right now, the person clicking "Route" on the dashboard never signs anything and never
connects a wallet.** The router pays all the agents itself, out of its own pre-funded
treasury wallet (`ROUTER_ADDR`). From the user's point of view, it looks like: type a task,
click a button, get a result (once the router wallet actually has funds — see §8). There is
no "approve this payment" prompt in that flow today.

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
│   ├── .env.wallets                ← gitignored — USER/ROUTER/ROUTER_FEE/AGENT1-3 wallets
│   ├── shared/                    ← constants (CAIP-2, ASA ID, routing fee, AGENT_REGISTRY),
│   │                                 types, replayGuard, verifyPayment (agent-side check)
│   ├── agents/
│   │   ├── research/  (port 4001, $0.03) — real Groq findings
│   │   ├── writer/    (port 4002, $0.02) — real Groq synthesis of research's findings
│   │   └── formatter/ (port 4003, $0.01) — real live currency conversion, NO LLM (hard
│   │                                        requirement — heterogeneity is judged)
│   ├── router/         ← index.ts (Hono app), qualityGate.ts, quote.ts, settle.ts,
│   │                      redeem.ts, selectAgents.ts, balances.ts, debugPreview.ts,
│   │                      previewCall.ts (shared no-payment call helper)
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

## 6. Adding a new agent — the registry is pluggable

`shared/constants.ts`'s `AGENT_REGISTRY` is the single source of truth for which agents
exist. Every part of the router — quoting, settling, redeeming, the quality gate, dynamic
agent selection, and the dashboard UI — reads this list; **none of them hardcode agent
names anymore.** To add a fourth (or fifth, ...) agent:

1. Build its service under `agents/<name>/` — same shape as the three existing ones: its own
   port, its own wallet, a price, an x402-gated `POST /work`, a `POST /redeem` that verifies
   on-chain, and an unprotected `POST /debug/preview` for the quality gate and demo mode.
2. Add its wallet address + mnemonic to `.env.wallets`.
3. Add one entry to `AGENT_REGISTRY`:
   ```ts
   {
     name: 'translator',
     url: 'http://localhost:4004',
     description: 'translates text into another language. Needed when the task asks for a translation.',
     dependsOn: ['writer'],                              // optional — auto-included when this agent is
     buildInput: (task, outputs) => ({ text: outputs.writer?.summary?.body ?? task }),
   }
   ```
   `description` is what the Groq agent-selector reads to decide when this agent is relevant.
   `dependsOn` names other agents whose output this one needs — selecting this agent
   automatically pulls in its dependencies too. `buildInput` builds this agent's request body
   from the task and every prior agent's output (keyed by name).

That's it — `quote.ts`/`settle.ts` already loop over whatever registry they're given,
`redeem.ts` and `debugPreview.ts` walk the registry in order calling each `buildInput`, and
the dashboard fetches `GET /agents` on load instead of hardcoding names, so the kill-switch
panel and result rendering pick up the new agent automatically too.

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
| P4 | No-payment preview mode (`/debug/preview`, on each agent + router) | `reference-implementation`'s "Preview (no payment)" button | Tested live end-to-end through the router: real N-agent pipeline, zero payment |
| — | Routing fee (5th leg in the settlement group) | (new, not from either repo — the analysis doc's recommendation) | Verified live in logs: `3 payout(s) + 1 routing fee + 1 fee-payer txn` |
| P3 | Groq-based dynamic agent selection (`router/selectAgents.ts`) | `reference-implementation`'s `llmExtractor.ts` pattern | Verified live: "Explain how Algorand consensus works" → QUOTE selects `[research, writer]` only, total $0.05, group size 4. "Convert 250 USD to EUR..." → selects all three, total $0.06, group size 5. Falls back to all three on any Groq failure. |
| — | "Preview (no payment)" button actually wired into the dashboard UI | (bug found in `BV_UncZ` itself) | The `/debug/preview` route existed but nothing in `ui/index.html` called it. Now wired up and tested live in-browser. |

**`MOCK=true` is still fully wired** on research/writer as a working fallback — flip one env
var if Groq or wifi is unreliable during the actual demo. Never mocks payment, only content.

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
send that output to a Groq judge with the prompt "is this genuinely relevant and substantive
for the task, or not?" Any single rejection aborts the entire route — `phase: "QUALITY"`,
`zeroSpend: true` — before any agent is even asked for a price, let alone paid.

**Fails open, on purpose:** if `GROQ_API_KEY` is missing or the Groq call errors, the gate
lets the request through rather than blocking the whole product on an LLM outage — same
policy as `selectAgents.ts`. This is a real limitation worth saying out loud to judges if
asked: the gate is a genuine safety net, not a guarantee, and it degrades gracefully rather
than failing closed.

**Demo/testing override:** relying on a live LLM to reliably reject on command during a demo
is risky, so there's also a manual lever, same idea as the agent kill switch:

```bash
curl -X POST http://localhost:4000/admin/quality-gate/fail   # force every task to be rejected
curl -X POST http://localhost:4000/admin/quality-gate/pass   # force every task to pass, skip the judge
curl -X POST http://localhost:4000/admin/quality-gate/auto   # back to the real Groq judge (default)
```
Same three buttons are on the dashboard under "Demo quality gate override."

---

## 9. What's still left

**Next milestone, not yet started:** wiring the actual end-user-facing x402 payment flow onto
the front of `/route` (see §4) — today the router pays from its own pre-funded wallet;
`client/` already proves the real challenge-and-sign mechanics work, it just isn't hooked up
to the dashboard's "Route" button yet.

**The one blocker underneath testing the paid flow end-to-end:** every wallet (`USER`,
`ROUTER`, `ROUTER_FEE`, `AGENT1-3`) is funded with ALGO and opted into the USDC ASA — but
**none of them has actual USDC**. Every settlement attempt has been proven correct right up
to `underflow on subtracting N from sender amount 0` — the group builds, signs, and submits
for real, it just can't move funds that don't exist. This has been the dominant time sink of
the entire project (see both `PROBLEMS.md` files for the full faucet saga). Until real
testnet USDC lands in `ROUTER_ADDR`, we don't have the single most important artifact for the
PPT: a real, confirmed, explorer-verifiable group ID.

**Not yet done at all:** demo rehearsal, PPT slides, the fresh-clone integration test.

---

## 10. How to test the different scenarios (no funds needed for any of these)

All of these work right now, without any testnet USDC, because they all fail (correctly)
*before* the SETTLE phase, which is the only step that actually needs funds.

**Normal task, everything healthy:**
```bash
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"Explain how Algorand consensus works","maxSpend":0.10}'
```
Expect: passes QUALITY, passes QUOTE (agents challenge with 402), fails at SETTLE with the
clear "router wallet needs funding" message — proves everything works except the very last,
funds-dependent step.

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
Expect: `BudgetExceededError` — total quoted cost (all 3 agents + routing fee, since this
task needs currency conversion) exceeds the $0.01 cap. Nothing is ever signed.

**Task-dependent agent selection (fewer agents quoted when fewer are needed):**
```bash
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"Explain how Algorand consensus works","maxSpend":0.10}'   # no currency → 2 agents, $0.05
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"Convert 250 USD to EUR","maxSpend":0.10}'                 # currency → 3 agents, $0.06
```
Check `router.out.log` (or the terminal running `npm run dev:router`) for the `agent
selection: [...]` line and the QUOTE total to see N actually change per request.

**All of the above work identically from the dashboard** — the phase boxes (QUALITY → QUOTE →
SETTLE → REDEEM) turn red at whichever step failed, with the same error text.

---

## 11. Running it yourself

```bash
cd BV_UncZ
npm install
cd pera_wallet_setup/scripts && npm install && cd ../..
# .env.wallets at BV_UncZ root needs USER/ROUTER/ROUTER_FEE/AGENT1/AGENT2/AGENT3 _ADDR + _MNEMONIC
# + GROQ_API_KEY (used by router/selectAgents.ts, router/qualityGate.ts, and the
#   research/writer agents; router falls back to safe defaults if it's missing —
#   optional but recommended)
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

Try the real thing (will fail cleanly until `ROUTER_ADDR` has USDC — see §9):
```bash
curl -X POST http://localhost:4000/route -H "Content-Type: application/json" \
  -d '{"task":"test","maxSpend":0.10}'
```

Full x402 client loop against one agent directly (the real payment mechanics, proven — see §4):
```bash
cd BV_UncZ/client && npm run test:agent -- http://localhost:4001/work
```

See `BV_UncZ/docs/PROBLEMS.md` and `reference-implementation/docs/PROBLEMS.md` for every
real bug either of us hit, with root cause and fix — worth reading before you hit the same
one twice.
