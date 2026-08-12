# x402 Multi-Agent Router — Team Status (PS0404)

For teammates checking in on progress. Plain-language summary: what's done, what's left, what's
being worked on right now, and what got merged in from Zaid's earlier solution. For the full
technical deep-dive (architecture diagrams, exact files, how everything works), read
[`explainer.md`](explainer.md) instead — this file is the quick version.

---

## The one-sentence pitch

We pay three separate AI agents (research, writer, formatter) for their work using **one single
Algorand transaction** — so either all three get paid and the user gets a full answer, or none of
them get paid and nothing is spent. No "two agents got paid and the third didn't" situation.

**The submission is `BV_UncZ/`.** That's Rohan's project, and it's the one that actually does the
"pay everyone at once" part. `reference-implementation/` is Zaid's earlier project — it doesn't do
the one-atomic-payment part, but several good pieces from it were copied into `BV_UncZ/` (see the
table below).

---

## 🎉 We're funded — this actually works now, for real

**2026-08-12:** a teammate shared a wallet that already had real testnet USDC in it. Swapped it
in as the router's wallet, and every payment flow that's been "proven correct but blocked on
money" all session **just settled for real** — three times in a row, including a real slash. Each
one produced a real group ID you can click open on the Algorand testnet explorer and see the
actual payments. This was *the* blocker for the whole project — it's gone. Full proof with the
actual group IDs: [`explainer.md` §12](explainer.md#12-the-funding-blocker-is-resolved--real-on-chain-proof).

**Heads up if you see `/balances` showing everyone at 0:** that's not the money disappearing —
it's `testnet-api.algonode.cloud` (the public node we read balances from) being intermittently
slow/unreachable, which has happened on and off all project. The dashboard fails open to
showing `0` when it can't reach the node, rather than crashing. The real proof is the group
IDs above, which don't depend on that endpoint being up right now — re-check balances once it
recovers, and run a fresh `check-balance.ts` right before any live demo rather than trusting an
old snapshot.

---

## 1. What's been done so far

- **Three paid agents are live**: research ($0.03), writer ($0.02), formatter ($0.01), each on
  its own port, each demanding real payment before doing work.
- **The router can quote all three at once**, add up the total price, and know upfront if any
  agent is offline — before spending a single cent.
- **The one-atomic-payment part works.** The router builds one real Algorand transaction group
  containing all the agent payments plus a small routing fee, signs it once, and submits it once.
  This has been tested live — the group builds and submits correctly.
- **Agents check payment themselves.** Each agent looks up the blockchain itself to confirm it
  got paid, rather than trusting the router's word for it. Tested by trying to trick an agent
  with the wrong payment proof — it correctly rejected it.
- **Safety checks before any money moves**: a budget cap (won't spend more than the user allows)
  and a group-size cap (Algorand only allows 16 transactions per group).
- **Anti-replay protection**: the same payment proof can't be used twice to get free work.
- **Demo kill-switch**: any agent can be "killed" on the spot to show what happens when one is
  offline — the whole payment is safely cancelled, nothing is spent.
- **"Preview (no payment)" button on the dashboard** — lets anyone see the three agents actually
  doing real work (real research, real writing, real currency conversion) without needing any
  test money at all. Useful for demos while wallets are unfunded.
- **The router now picks agents per task instead of always using all three** — e.g. a plain
  question only pays research + writer ($0.05 total), but a currency question also pulls in the
  formatter ($0.06 total). Decided automatically using Groq (an AI model), with a safe fallback
  to "just use all three" if that call ever fails.
- **Any teammate can add a new agent without touching the core router code** — one entry in a
  registry file (name, port, description, what it needs from other agents) and the quoting,
  paying, redeeming, and dashboard all pick it up automatically.
- **Quality gate.** Before any agent is even asked for a price, the router quietly runs each one
  for free and has an AI judge check the output is actually good. There's also a manual override
  for reliable live demos (force pass / force fail — either for everyone, or targeted at one
  specific agent).
- **Stake + slash — the "wow" feature.** One agent (formatter) has its own dedicated stake wallet
  that the router controls. If that agent's answer fails the quality check, it gets paid nothing
  and its stake pays a rebate straight to the user instead — in the *same* single transaction as
  everyone else's normal payment. **Ran for real** — formatter got nothing, the user got a real
  0.5 USDC rebate, research and writer got paid normally, all in one confirmed group.
- **Self-test replay button** — judges can fire several identical payment-proof attempts at an
  agent with one click and watch, live, that only one is ever accepted and the rest are correctly
  rejected as duplicates.
- **GitHub repo set up**, both projects pushed, documented, and kept in sync.

## 2. What's left

- **Wire up real payment from the user's own wallet.** Right now the router pays every agent out
  of its own pre-loaded wallet — clicking "Route" doesn't ask you to sign or approve anything.
  The actual "user pays" flow (get asked for payment, sign it, retry) is proven to work as a
  separate standalone test (`BV_UncZ/client/`), it just isn't hooked up to the "Route" button
  yet. This is the last real piece of unfinished architecture.
- **Demo rehearsal and slides** — not started yet, now unblocked (we have real proof to show).
- **A clean "clone the repo and run it" test** — making sure someone starting from scratch can
  get it running without hitting the setup snags we already worked through.

## 3. What's being worked on right now

Nothing is actively mid-task. The most recent milestone: the router's wallet got funded with
real testnet USDC and every payment flow (plain multi-agent payout, and the stake+slash) has now
been run for real, not just proven up to the funding wall. Next up: wiring real user-facing
payment onto the "Route" button, and starting demo/slide prep.

## 4. What was ported from Zaid's `reference-implementation/`

| From reference-implementation | Into BV_UncZ, as | Why |
|---|---|---|
| Full "pay → get challenged → sign → retry → success" client flow | `BV_UncZ/client/` | `BV_UncZ`'s router pays agents directly and never ran the full client-side payment flow end to end — this proves that flow really works. |
| Groq-powered research answers | Research agent's real content | Was a placeholder before; now produces real, sourced findings. |
| Groq-powered writing/summarizing | Writer agent's real content | Same idea — real synthesis instead of a placeholder. |
| Live currency-conversion logic | Formatter agent's real content | Replaced a chart that didn't mean anything with real, live exchange-rate conversions. |
| "Preview without paying" idea | `/debug/preview` route + dashboard button | Lets anyone see real agent output without needing test money — good for demos. |
| Automatic agent-selection using Groq | `router/selectAgents.ts` | Same technique Zaid used to figure out what a user's task needs — now decides which paid agents the router should even bother calling. |

**Not ported, on purpose:** the package versions and the single-payment-endpoint design.
`BV_UncZ`'s entire point is paying multiple agents *at once* — a single bundled endpoint doesn't
demonstrate that, so that design wasn't brought over.

---

## 5. How payment works right now, in plain terms

Click "Route" today and **you won't be asked to sign or approve anything.** The router pays all
the agents itself, out of its own pre-loaded test wallet — like a company card, not your own
wallet — and, as of the funding update above, that card actually has money on it now. That's
intentional for this stage: the hard, novel part (paying several agents in one unbreakable
transaction) is what's built, proven, *and now actually working end to end*. The normal,
well-understood part (a real person's wallet paying for something over x402) is proven separately
as a standalone test, just not connected to the dashboard yet — that's the "what's left" item
above. Full explanation with the technical reasoning: [`explainer.md` §4](explainer.md#4-how-payment-actually-works-from-a-users-perspective--read-this-carefully).

## 6. How to test the tricky cases yourself

No test-money needed for any of these — they all fail (correctly, on purpose) at a step before
money would move:

- **A bad/low-quality answer → no payment**: `curl -X POST http://localhost:4000/admin/quality-gate/fail`, then try routing anything. Reset with `.../auto`.
- **A bad answer from specifically the staked agent → it gets slashed, others still get paid**: `curl -X POST http://localhost:4000/admin/quality-gate/target/formatter`, then route a currency task. Reset with `.../target-clear`.
- **One agent goes down mid-task**: `curl -X POST http://localhost:4000/admin/kill/writer`, then try routing anything. Reset with `.../admin/revive/writer`.
- **Spending limit too low**: route a currency task with a tiny `maxSpend` (e.g. `0.01`) — it refuses before signing anything.
- **Prove the anti-replay guard**: `curl -X POST http://localhost:4000/self-test/replay -d '{"agent":"research","n":6}'` — watch exactly 1 of 6 identical attempts get accepted.

Full commands and expected output for each: [`explainer.md` §14](explainer.md#14-how-to-test-the-different-scenarios).

---

## How to run it

```bash
cd BV_UncZ
npm install
cd pera_wallet_setup/scripts && npm install && cd ../..
# .env.wallets at repo root needs USER/ROUTER/ROUTER_FEE/AGENT1/AGENT2/AGENT3 _ADDR + _MNEMONIC
# + GROQ_API_KEY (optional — router falls back to using all agents if missing)
npm run dev:research    # port 4001, $0.03
npm run dev:writer      # port 4002, $0.02
npm run dev:formatter   # port 4003, $0.01
npm run dev:router      # port 4000 — dashboard at http://localhost:4000
```

On the dashboard, click **"Preview (no payment)"** to see real agent output with zero test money
needed, or **"Route"** to run the real payment flow — with our current `.env.wallets`, this now
actually settles for real (see the funding update above); with your own unfunded wallets it'll
show a clear "needs funding" message instead of a generic error.

Full details, architecture diagrams, and every bug we hit along the way:
[`explainer.md`](explainer.md) · [`BV_UncZ/README.md`](BV_UncZ/README.md) ·
[`BV_UncZ/docs/PROBLEMS.md`](BV_UncZ/docs/PROBLEMS.md)

---

## Neither wallet has real value

Everything in this repo runs on **Algorand Testnet** only. All ALGO and USDC involved are free,
worthless test tokens from public faucets — nothing here touches real money.

## Secrets

No `.env` / `.env.wallets` files are committed anywhere in this repo. Anyone cloning this repo
needs to supply their own testnet wallets and a Groq API key before any paid flow will do
anything — copy the `.env.example` files and fill them in.
