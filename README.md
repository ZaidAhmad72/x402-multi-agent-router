# x402 on Algorand — Atomic Multi-Agent Service Router

**Competition submission: `BV_UncZ/`.** This is the primary project — it implements the
actual problem statement (PS0404): pay multiple independent agents in **one atomic Algorand
transaction group**, so either all agents are paid and the caller gets a complete result, or
none are paid and nothing is spent.

`reference-implementation/` is a second, independently-built project (single payment-gated
endpoint, no atomic group) kept in this repo because several of its pieces were ported into
`BV_UncZ/` — see below for exactly what and why.

---

## `BV_UncZ/` — the submission

Three independently-paid agent services (research/writer/formatter), fanned in through one
atomic transaction group: either all three agents get paid in a single unbreakable group, or
none do. Includes agent-side on-chain payment verification (agents don't trust the router,
verified adversarially), a replay guard, a live demo kill-switch, and a budget/group-size gate
enforced before anything is ever signed.

Full architecture, setup, and its own problems log:
[`BV_UncZ/README.md`](BV_UncZ/README.md) · [`BV_UncZ/docs/PROBLEMS.md`](BV_UncZ/docs/PROBLEMS.md)

### Status

All phases built per its own `CLAUDE.md`. Verified live: all three agents challenge with
`402` at distinct prices, the router's quote phase aggregates them correctly, and it builds,
signs, and submits a real 4-transaction atomic group — settlement itself is blocked on a
testnet-USDC shortage (every wallet is funded with ALGO and opted into the USDC ASA, but
getting actual USDC into them has been the dominant time sink of this whole project — see
`docs/PROBLEMS.md` in both projects for the full faucet saga).

**Fixed since the initial build:**
- `intra-round-offset` in `shared/verifyPayment.ts` was being trusted as if it were the
  transaction's position within the payment *group* — it's actually the position within the
  confirming *round*, which only coincidentally matches on a quiet round. Now sorted and
  indexed by position instead, so agent-side verification can't silently break on a busy round.
- Added `client/` — the complete x402 client loop (unpaid → `402` → signed retry → `200` →
  decoded settlement receipt) run directly against one agent's payment-gated route. The
  router itself pays agents by direct transfer and never exercises the full protocol client
  loop, so this closes that gap. Ported and adapted from `reference-implementation/client/`.

### Setup

```bash
cd BV_UncZ
npm install
cd pera_wallet_setup/scripts && npm install && cd ../..
# .env.wallets at repo root needs USER/ROUTER/AGENT1/AGENT2/AGENT3 _ADDR + _MNEMONIC
npm run dev:research    # port 4001, $0.03
npm run dev:writer      # port 4002, $0.02
npm run dev:formatter   # port 4003, $0.01
npm run dev:router      # port 4000 — serves the dashboard at http://localhost:4000
```

Full x402 client loop against one agent directly:

```bash
cd BV_UncZ/client
npm run test:agent -- http://localhost:4001/work
```

---

## `reference-implementation/` — single-endpoint router (not the submission)

A Hono server with **one payment-protected endpoint**, `GET /router/task`, that fans a single
`$0.01` payment out to three real, live services (weather via Open-Meteo, currency via
ExchangeRate-API, AI analysis via Groq) and returns a combined answer. No atomic group — one
payment, in-process function calls. Kept in this repo because it's the source for what got
ported into `BV_UncZ/`, and because its dashboard, Groq-based intent extraction, and
server-side payment-demo pattern are referenced in `BV_UncZ/docs/PROBLEMS.md`.

Setup and its own problems log: [`reference-implementation/docs/PROBLEMS.md`](reference-implementation/docs/PROBLEMS.md)

```bash
cd reference-implementation/server
npm install
cp .env.example .env   # fill in PAYTO_ADDRESS, GROQ_API_KEY, DEMO_PAYER_MNEMONIC
npm run dev
```

---

## Neither wallet has real value

Everything in this repo runs on **Algorand Testnet** only. All ALGO and USDC involved are
free, worthless test tokens obtained from public faucets — nothing here touches real money.

## Secrets

No `.env` / `.env.wallets` files are committed anywhere in this repo (see each project's
`.gitignore`). Anyone cloning this repo needs to supply their own testnet wallets and a Groq
API key before any paid flow will do anything — copy the `.env.example` files and fill them in.
