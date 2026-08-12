# x402 on Algorand — Multi-Agent Service Router

This repo holds **two separate implementations** of the same hackathon idea — pay-per-use AI
services gated by the [x402 protocol](https://x402.org) on Algorand Testnet. They were built
independently, by two people, and haven't been merged. This README explains what each one is
and how to run it. Each has its own detailed docs linked below.

---

## `server/` + `client/` — single-endpoint router (this team member's build)

A Hono server with **one payment-protected endpoint**, `GET /router/task`, that fans a single
`$0.01` payment out to three real, live services and returns a combined answer:

- **Weather** (Open-Meteo, no API key)
- **Currency conversion** (ExchangeRate-API, no API key)
- **AI analysis** (Groq/Llama 3.3, synthesizes the other two)

Which services run, and their parameters (location, amounts, currencies), are decided by a
single Groq call per request — not hand-rolled regex — with an automatic fallback to
keyword/regex matching if Groq is ever unavailable, so the endpoint keeps working through a
Groq outage.

Includes a minimal dashboard (`server/public/index.html`, served at `http://localhost:3000`)
showing the router's decision, live payment status, the on-chain transaction proof, and live
wallet balances — plus a **debug-only "Preview" mode** that runs the same agent logic without
the payment gate, useful for testing while a wallet is unfunded.

### Status

Fully built and tested down to the one thing outside this code's control: **real testnet
USDC**. Every piece — the 402 challenge, payment verification, agent orchestration, per-agent
failure isolation, the dashboard, a from-scratch `npm install` — has been verified live. What
hasn't been verified live yet is an actual **paid `200` response with a real, explorer-checked
transaction ID**, because neither demo wallet has received testnet USDC despite repeated
faucet attempts (see [`docs/PROBLEMS.md`](docs/PROBLEMS.md) for the full story). The code path
for that is built and has been proven correct right up to "insufficient balance" — it just
needs funds to complete.

### Setup

```bash
cd server
npm install
cp .env.example .env   # fill in PAYTO_ADDRESS, GROQ_API_KEY, DEMO_PAYER_MNEMONIC
npm run dev
```

Open `http://localhost:3000` for the dashboard, or:

```bash
curl "http://localhost:3000/router/task?task=weather+in+berlin"     # expect 402
curl "http://localhost:3000/debug/preview?task=weather+in+berlin"   # real answer, no payment
```

Optional command-line payment test client:

```bash
cd client
npm install
cp .env.example .env   # fill in CLIENT_WALLET_MNEMONIC (needs testnet ALGO + USDC)
npm run test:router-task
```

See [`docs/PROBLEMS.md`](docs/PROBLEMS.md) for every real bug hit while building this
(package/facilitator mismatches, faucet failures, intent-extraction bugs), with root cause and
fix for each.

---

## `BV_UncZ-master/` — atomic multi-agent router (teammate's build)

A more ambitious design: three independently-paid agent services (research/writer/formatter),
fanned in through **one Algorand atomic transaction group** — either all three agents get paid
in a single unbreakable group, or none do. Includes agent-side on-chain payment verification
(agents don't trust the router), a replay guard, and a live demo kill-switch.

Full architecture, setup, and its own problems log live in
[`BV_UncZ-master/README.md`](BV_UncZ-master/README.md) and
[`BV_UncZ-master/docs/PROBLEMS.md`](BV_UncZ-master/docs/PROBLEMS.md).

### Status

All phases built per its own `CLAUDE.md`. Verified live: all three agents challenge with
`402` at distinct prices, the router's quote phase aggregates them correctly, and it builds,
signs, and submits a real 4-transaction atomic group — settlement itself is blocked on the
same testnet-USDC shortage described above.

---

## Neither wallet has real value

Everything above runs on **Algorand Testnet** only. All ALGO and USDC involved are free,
worthless test tokens obtained from public faucets — nothing here touches real money.

## Secrets

Neither project's `.env` files are committed (see each subproject's `.gitignore`). Anyone
cloning this repo needs to supply their own testnet wallet(s) and a Groq API key before the
paid flows will do anything — copy the `.env.example` in each folder and fill it in.
