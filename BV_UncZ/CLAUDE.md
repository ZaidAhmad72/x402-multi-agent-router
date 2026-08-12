# CLAUDE.md — Atomic Multi-Agent Service Router

Project spec and working agreement. Read this file completely before writing any code.

---

## 0. Read this first — non-negotiable working rules

1. **Ground yourself in `reference/` before every subsystem.** This project uses `@x402-avm/*` packages for x402 on the Algorand Virtual Machine. This API is newer than your training data and you will invent function names if you rely on memory. Before writing x402 code, read:
   - `reference/x402-starter/x402-demo-server/index.ts`
   - `reference/x402-starter/x402-demo-server/endpoints.config.ts`
   - `reference/x402-starter/x402-demo-server/handlers/*.ts`
   - `reference/goplausible-docs/profile/algorand-x402-documentation/`

   **Use only imports, function names, and config shapes that actually appear in those files.** If you need something that isn't there, say so and ask rather than guessing.

2. **Build in phases. One phase per request.** Do not scaffold the whole project up front. Phases are defined in §4.

3. **Verify, don't assert.** After each phase, run the actual curl command or script and show real output. Never say "this should work now."

4. **Time budget is ~4 hours total.** Prefer the boring working solution. If a choice is between elegant and shippable, ship.

5. **Never invent transaction IDs, group IDs, or explorer links.** If something didn't settle, say it didn't settle.

---

## 1. What this is

A single orchestration endpoint that accepts one user task, fans it out to three independent paid AI agents, and **pays all three in one Algorand atomic transaction group** — so either every agent is paid and the user gets a complete result, or nobody is paid and nothing is spent.

**The problem:** today an orchestrator calls three paid services sequentially. The researcher gets paid, the writer gets paid, the designer times out. The user has spent money and has no deliverable. No rollback, no refund path.

**The core claim:** *N quotes, one group, one atomic commitment.*

This is Algorand-specific: atomic transaction groups are a protocol primitive (up to 16 transactions sharing one group ID, all-or-nothing, no smart contract needed). The same guarantee on EVM chains requires deploying a batching contract.

---

## 2. Architecture — two legs

### Inbound leg — vanilla x402 (protocol compliance)
```
User → POST /route (no payment header)
     → Router quotes the three agents LIVE
     → Router returns 402 with total price = sum(agent prices) + routing fee
     → User signs a PaymentPayload, retries with X-PAYMENT header
     → Router verifies + settles via facilitator.goplausible.xyz
```
Use the starter kit's standard middleware pattern for this leg. Do not hand-roll it.

### Outbound leg — atomic fan-in (the novelty)
```
Router builds ONE atomic group:
    [0] USDC transfer → agent-1 payTo
    [1] USDC transfer → agent-2 payTo
    [2] USDC transfer → agent-3 payTo
    [3] fee-payer transaction (pooled fees)
  → compute group ID, sign, submit, one confirmation
  → redeem: call each agent with the group ID + its index as proof
  → agent verifies on-chain that it was paid, then does the work
  → return assembled result + ONE group ID + explorer link
```

### Why not just call each agent with x402 normally?
Because **an x402 AVM payment is already its own atomic group** (payment txn + fee-payer txn). Three sequential x402 calls produce **three independent group IDs**. That is exactly the failure this project exists to fix. The whole contribution is separating the 402 challenge phase from the settlement phase so that N challenges collapse into one group.

### Sequence
```
USER              ROUTER                 AGENTS              ALGORAND
 │                  │                       │                    │
 │─ task+budget ───>│                       │                    │
 │                  │── GET (no payment) ──>│                    │
 │                  │<── 402 + reqs ────────│  (x3 parallel)     │
 │<── 402 total ────│                       │                    │
 │─ signed retry ──>│                       │                    │
 │                  │  verify+settle via facilitator ───────────>│
 │                  │  budget gate + group size gate             │
 │                  │  build ONE group, sign, submit ───────────>│
 │                  │<────── one group ID ───────────────────────│
 │                  │── groupID + index ───>│                    │
 │                  │                       │─ verify on chain ─>│
 │                  │<── 200 + result ──────│                    │
 │<─ result + ONE ──│                       │                    │
 │   group ID       │                       │                    │
```

---

## 3. Constants and configuration

```ts
ALGORAND_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="
USDC_TESTNET_ASA_ID    = "10458941"                        // 6 decimals
FACILITATOR_URL        = "https://facilitator.goplausible.xyz"
ALGOD_TESTNET          = "https://testnet-api.algonode.cloud"
INDEXER_TESTNET        = "https://testnet-idx.algonode.cloud"
EXPLORER_GROUP_URL     = "https://lora.algokit.io/testnet/group/"
```

**Scheme: `exact` only.** There is no `upto` scheme implemented for AVM. Every AVM example registers the exact scheme. Do not design around `upto`.

**Fee abstraction** is automatic in the AVM exact scheme when the payment requirements include a fee-payer address — the client signs only its payment transaction and the facilitator co-signs the fee transaction at settlement. This is why agent wallets can hold zero ALGO. Surface this in the UI; it is a scoring point.

Wallet addresses and mnemonics live in `.env.wallets` (gitignored) and are loaded per service. **Never commit secrets. Never print a mnemonic to stdout or into a log file.**

---

## 4. Build phases

Build these strictly in order. Stop after each and report.

### Phase 1 — Three agent services

Three independent x402-gated services, each with its own wallet, port, and price. Follow the starter kit's patterns exactly.

| Agent | Port | Endpoint | Price | Does | Constraint |
|---|---|---|---|---|---|
| research | 4001 | `POST /work` | $0.03 | Task → sourced bullet findings | May use an LLM or a stubbed search |
| writer | 4002 | `POST /work` | $0.02 | Findings → structured summary | May use an LLM |
| formatter | 4003 | `POST /work` | $0.01 | Text → rendered chart/PDF/QR | **MUST NOT use an LLM.** Deterministic only. |

The formatter being non-LLM is a hard requirement — heterogeneity is explicitly checked by judges, and a deterministic agent always works on stage.

If an LLM API key isn't available, stub research and writer with realistic canned responses behind a `MOCK=true` flag, but keep the x402 payment path completely real. Never mock the payment.

**Done when:** `curl -i localhost:400X/work` returns 402 for all three, each with a distinct `payTo` and price.

### Phase 2a — Router quote phase

`POST /route` with body `{ task, maxSpend }`.

- Call all three agents in parallel with **no payment header**
- Each must respond 402; decode the `PaymentRequirements` (base64 JSON in body/header — check the reference for exact location)
- Extract `payTo`, `asset`, `maxAmountRequired` per agent
- Sum into a total
- Log each 402 as it arrives, clearly, with the agent name and price
- An agent that is down or doesn't challenge → throw here, **before any money moves**. This is the liveness guarantee; make the error message say so.

**Done when:** one curl shows three 402s aggregating to $0.06.

### Phase 2b — Atomic group composition and settlement

```
1. budget gate:  if total > maxSpend  → throw BudgetExceeded, nothing signed
2. size gate:    if quotes.length + 1 > 16 → throw GroupTooLarge
3. build ONE group with AtomicTransactionComposer:
     - one ASA transfer per agent (assetIndex = USDC ASA, amount from quote,
       fee: 0, flatFee: true so fees are pooled)
     - one fee-payer transaction with fee = 1000 * (N + 1), flatFee: true
4. execute, capture groupId, per-index txIds, confirmedRound
5. return groupId + explorer URL
```

Both gates must throw **before** any signing or network call. That ordering is the point — the budget gate is the project's spend-authorization story.

Use `AtomicTransactionComposer` from `@algorandfoundation/algokit-utils`. **`algosdk` is no longer a dependency from v2.6+** — do not add it back.

Mechanics to respect: transactions are created individually then grouped, each receiving the same group ID derived from the **ordered** set; senders sign only their own transactions; a single submitter broadcasts the full ordered group. The group cannot be modified after signing.

**Done when:** the explorer URL shows three payments under one group ID. This is the single most important checkpoint in the project.

### Phase 3 — Redeem, verification, failure path

**Redeem:** router calls each agent again with headers `X-PAYMENT-GROUP: <groupId>` and `X-PAYMENT-INDEX: <i>`.

**Agent-side verification:** each agent looks up the group via the indexer and confirms that the transaction at its index pays *its own* wallet at least its quoted amount. **The agent must not trust the router.** This is a real design property, not decoration 
— say so in the README.

**Replay guard** on redemption:
```ts
const redeemed = new Map();               // `${groupId}:${index}` -> expiry
const TTL = 300_000;
function guard(groupId, index) {
  const key = `${groupId}:${index}`;
  const now = Date.now();
  for (const [k, exp] of redeemed) if (exp < now) redeemed.delete(k);
  if (redeemed.has(key)) throw new Error("replay rejected");
  redeemed.set(key, now + TTL);
}
```
Call `guard()` **before doing any work**, never after. That ordering is the entire point — it's the fix for the known x402 facilitator race condition where a stateless verify lets a valid proof be replayed across concurrent requests.

**Kill switch:** `POST /admin/kill/:agentId` and `POST /admin/revive/:agentId`. A killed agent stops responding, so the quote phase fails and the group is never built. This must be a real feature with a clean user-facing error, not a hack — it is the centrepiece of the live demo.

**Done when:** killing an agent produces an abort with zero spend and the user's USDC balance is provably unchanged.

### Phase 4 — Minimal UI

Single page. Task input, budget input, live phase indicator (`QUOTE → SETTLE → REDEEM`), results panel, group ID as a clickable explorer link, and a visible "agent wallet ALGO balance: 0" readout to show fee abstraction.

Prioritise the phase indicator and the group ID link — those get screenshotted for the PPT. **Do not spend time on styling polish.**

If a browser wallet payment UI is needed for the inbound leg, check whether `@x402-avm/paywall` is available in the reference docs before building one by hand.

---

## 5. Repository layout

```
BV_UncZ/
├── CLAUDE.md                  ← this file
├── README.md                  ← write in Phase 4
├── .env.wallets               ← gitignored, 5 addresses + mnemonics
├── .gitignore
├── reference/                 ← READ-ONLY. Never edit. Cloned repos.
│   ├── x402-starter/
│   └── goplausible-docs/
├── shared/
│   ├── constants.ts           ← CAIP-2, ASA ID, URLs
│   └── types.ts               ← Quote, Settlement, RouteRequest, RouteResponse
├── agents/
│   ├── research/              ← port 4001
│   ├── writer/                ← port 4002
│   └── formatter/             ← port 4003  (NO LLM)
├── router/
│   ├── index.ts               ← Hono app, /route, /admin/*
│   ├── quote.ts               ← Phase 2a
│   ├── settle.ts              ← Phase 2b — atomic group
│   ├── redeem.ts              ← Phase 3
│   └── guard.ts               ← replay guard
├── ui/
├── scripts/
│   ├── setup-wallets.ts       ← generate accounts, opt in to USDC ASA
│   ├── check-balances.ts      ← print ALGO + USDC for all 5 wallets
│   └── prove-atomic-group.ts  ← standalone fallback, see §7
└── docs/
    └── screenshots/
```

---

## 6. Definition of done

- [ ] Three x402-gated agents on separate wallets, all returning 402
- [ ] Router quote phase aggregating three live 402s into a total
- [ ] **Single atomic group settlement with one verifiable group ID on the testnet explorer**
- [ ] Budget cap enforced before signing
- [ ] Group size gate at 16
- [ ] Agent-side on-chain payment verification (agents don't trust the router)
- [ ] Replay guard on redemption, checked before work
- [ ] Failure path: agent down → abort, zero spend, clear error
- [ ] Group ID + explorer link in both the response body and a response header
- [ ] Minimal UI driving the whole flow
- [ ] README with architecture diagram, setup steps, and a **real settled group ID**

---

## 7. Fallback plan — read this before you get stuck

If atomic group composition is not settling and time is short, **do not keep debugging.** Switch to this:

1. Keep the working per-agent x402 flow (three separate payments). It still demonstrates the full protocol.
2. Write `scripts/prove-atomic-group.ts` — a standalone script with no router or agent logic that composes and submits one atomic group of three USDC transfers plus a fee payer, and prints the group ID and explorer URL.
3. That script's group ID is the on-chain evidence for the PPT.

The architecture is then presented as the design, with the standalone script proving the primitive works and integration as the remaining task. Say this plainly. **Never present the sequential flow as if it were atomic** — a judge who checks the explorer will see separate group IDs immediately, and that is a much worse outcome than an honest scope statement.

---

## 8. Explicitly NOT in scope

Do not build these. They belong on the future-scope slide.

| Not building | Why |
|---|---|
| Quality escrow / conditional release | Needs a smart contract and a quality oracle. Not responsible in the time available. |
| More than ~13 agents | Hard protocol limit of 16 transactions per group. |
| Dynamic agent discovery (Bazaar) | Registry is hardcoded. Bazaar integration is a second project. |
| Streaming / long-running agents | Async job payment is a genuinely unsolved design question in x402. |
| Mainnet | Testnet only. Organisers confirmed mainnet gives no judging advantage. Same code path; only the CAIP-2 constant and ASA ID change. |
| Multi-user, auth, persistence | Single-session demo. |
| Retry / partial fulfilment | Deliberate design choice — all-or-nothing *is* the product. Partial delivery would undermine the guarantee. |
| Reputation / agent ranking | No data to rank on. |

**The known limitation to state in the README:** atomic payment is not atomic *execution*. Paying three agents in one unbreakable group does not guarantee any of them returned good output. The partial mitigation implemented here is the quote-phase liveness check — a dead agent never enters the group, so the most common failure is caught before money moves. The full fix is escrow-based conditional release, which is the next milestone.

---

## 9. Known failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Payment silently fails | Wallet not opted in to USDC ASA 10458941 | Opt in. Most common failure by far. |
| Endless 402 | Wrong network or no USDC | TestNet + Circle faucet |
| `algosdk` import errors | Dropped as a dependency in v2.6+ | Use `@algorandfoundation/algokit-utils` |
| Only one txn lands | Not actually grouped, or not submitted together | One submitter broadcasts the full ordered group |
| Invalid signature on group | Group modified after signing | Group ID hashes the ordered set — rebuild and re-sign |
| CORS errors | Middleware order | CORS before payment middleware |

---

## 10. Vocabulary — use these exact phrases in code comments and README

- "N quotes, one group, one atomic commitment"
- "We fan out the payment challenges and fan in the settlement"
- "Atomic payment is not atomic execution"
- "The agent verifies on-chain; it does not trust the router"
- "Budget gate runs before anything is signed"

These are the project's claims. Keeping the language consistent between the code, the README and the pitch makes the whole thing read as one coherent piece of engineering.
