# x402 Multi-Agent Router — Team Status (PS0404)

For teammates checking in on progress. Plain-language summary: what's done, what's left, what's
being worked on right now, how the whole thing actually works, and what got merged in from
Zaid's earlier solution. For the full technical deep-dive (architecture diagrams, exact files),
read [`explainer.md`](explainer.md) instead — this file is the quick version.

---

## The one-sentence pitch

We pay several separate AI agents (research, writer, currency conversion, weather, and a
narrative-synthesis agent) for their work using **one single Algorand transaction** — so
either everyone who's supposed to get paid does, and the user gets a full answer, or nobody
gets paid and nothing is spent. No "some agents got paid and the rest didn't" situation.

**The submission is `BV_UncZ/`.** That's Rohan's project, and it's the one that actually does the
"pay everyone at once" part. `reference-implementation/` is Zaid's earlier project — it doesn't do
the one-atomic-payment part, but several good pieces from it were copied into `BV_UncZ/` (see the
table below), including the weather agent restoring Zaid's original weather/currency/analysis idea.

---

## 🎉 We're funded — this actually works now, for real

**2026-08-12:** a teammate shared a wallet that already had real testnet USDC in it. Swapped it
in as the router's wallet, and every payment flow that's been "proven correct but blocked on
money" all session **just settled for real** — repeatedly, including a real slash. Each one
produced a real group ID you can click open on the Algorand testnet explorer and see the actual
payments. This was *the* blocker for the whole project — it's gone. Full proof with the
actual group IDs: [`explainer.md` §12](explainer.md#12-the-funding-blocker-is-resolved--real-on-chain-proof).

**Heads up if you see `/balances` showing everyone at 0, or a redeem step fail:** that's not
money disappearing — Algorand's public testnet nodes (`algonode.cloud`) have been
intermittently slow/unreachable at points during this project, and always recovered within
about half an hour. The dashboard fails open to showing `0` when it can't reach the node,
rather than crashing, and a redeem step can fail the same way even *after* a payment already
went through for real. The real proof is the group IDs in `explainer.md` §12, which don't
depend on any endpoint being up right now — re-check once connectivity recovers, and run a
fresh `check-balance.ts` right before any live demo rather than trusting an old snapshot.

---

## How the whole thing actually works (read this if you're new to any of these words)

**What you'd see if you opened the dashboard right now:** a box to type a task into, a
max-spend box, three quick-fill example buttons (a general task, a currency-conversion task,
and a weather+currency task), a big **Route** button and a **Preview (no payment)** button, and
a row of four boxes (QUALITY → QUOTE → SETTLE → REDEEM) that light up green or red as a request
actually works its way through the system. Click Route, and — assuming the wallets are funded,
which ours are right now — you get back a real answer, a real settlement receipt showing who
got paid what, and a link to the actual transaction on a public blockchain explorer.

**What happens in between, roughly:**
1. You type a task and click Route.
2. The router asks an AI model which of the five agents this task actually needs (a weather
   question doesn't need the currency agent; a "summarize X" question doesn't need weather).
3. Each of those agents is trial-run for free, and a second AI check makes sure the output is
   actually good *before* anyone gets asked for money.
4. Each agent then says how much it charges. The router adds it up.
5. The router builds **one single blockchain transaction** that pays every agent at once — this
   is the actual novel part of the project — signs it, and sends it to Algorand.
6. Once that's confirmed, each agent is asked to prove it actually got paid (each one checks
   the blockchain itself, it doesn't just take the router's word for it), and then does its
   real work and hands back the result.
7. You get the combined answer, plus a link to the one transaction group that paid everyone.

**The building blocks, in plain terms:**
- **Algorand** is the blockchain we're using — think of it as a shared, public record book that
  everyone (the router, every agent, anyone with the link) can check independently. Its killer
  feature for this project is being able to bundle several payments into **one** transaction
  that either all goes through or none of it does — that's the entire point of the project.
- A **wallet** is just an address (where money can be sent) plus a private key (proof you're
  allowed to spend from it). Every piece here — the router, each of the 5 agents, a small
  "routing fee" account, and a "stake" account used for the accountability feature — has its own
  wallet. All of them hold **fake, testnet money**, worth nothing real.
- **x402** is the actual internet standard being demonstrated — a normal "HTTP 402 Payment
  Required" web response, extended to say exactly what to pay and where. Each agent speaks this
  natively: ask it for work with no payment, it replies "402, here's my price"; pay that exact
  price, ask again, get the real answer. This project's job is doing that with five agents *at
  once*, atomically, instead of one at a time.
- The **agents** are the five actual paid workers — research, writer, currency-conversion
  (formatter), weather, and a narrative-synthesis agent (analysis). Each is a separate program
  with its own price and its own wallet, and none of them know about each other — only the
  router sees the full picture.
- The **router** is the conductor. It never does the actual work — its whole job is figuring out
  which agents a task needs, checking their answers are good, paying everyone in one shot, and
  handing back the combined result.

One honest caveat, spelled out fully in `explainer.md` §4: **right now the router pays with its
own money, not yours** — clicking Route doesn't ask you to sign anything or connect a wallet.
That's intentional for this stage (the hard part — paying several agents atomically — is what's
built and proven); a real person paying via their own wallet is proven to work separately but
not yet wired to the dashboard button. That's the one big remaining piece, see "What's left" below.

---

## 1. What's been done so far

- **Five paid agents are live**: research ($0.03), writer ($0.02), currency-conversion/formatter
  ($0.01), weather ($0.02), and analysis ($0.02) — each on its own port, each demanding real
  payment before doing work. Weather and analysis are new — see the "weather agent" note below.
- **The router can quote every relevant agent at once**, add up the total price, and know
  upfront if any agent is offline — before spending a single cent.
- **The one-atomic-payment part works, for real.** The router builds one real Algorand
  transaction group containing every agent's payment plus a small routing fee, signs it once,
  and submits it once. This has been tested live with real settled transactions — see the
  funding update above.
- **Agents check payment themselves.** Each agent looks up the blockchain itself to confirm it
  got paid, rather than trusting the router's word for it. Tested by trying to trick an agent
  with the wrong payment proof — it correctly rejected it.
- **Safety checks before any money moves**: a budget cap (won't spend more than the user allows)
  and a group-size cap (Algorand only allows 16 transactions per group).
- **Anti-replay protection**: the same payment proof can't be used twice to get free work —
  judges can prove this themselves with the self-test replay button (see below).
- **Demo kill-switch**: any agent can be "killed" on the spot to show what happens when one is
  offline — the whole payment is safely cancelled, nothing is spent.
- **"Preview (no payment)" button on the dashboard** — lets anyone see the agents actually doing
  real work (real research, real writing, real currency conversion, real weather) without
  needing any test money at all. Useful for demos while wallets are unfunded.
- **The router now picks agents per task instead of always using all of them** — e.g. a plain
  question only pays research + writer, but a currency question also pulls in the formatter, and
  a weather question pulls in the weather + analysis agents instead. Decided automatically using
  an AI model, with a safe fallback to "just use everything" if that call ever fails.
- **Any teammate can add a new agent without touching the core router code** — one entry in a
  registry file (name, port, description, what it needs from other agents) and the quoting,
  paying, redeeming, and dashboard all pick it up automatically. **Proven twice, live** — that's
  exactly how the weather and analysis agents below got added.
- **The weather agent is back.** Zaid's original solo project had three agents: weather,
  currency, and an AI that tied them together. Currency was already ported into `BV_UncZ` as the
  formatter agent; now weather and the tie-it-together agent (analysis) have been added too, so
  the full trio works inside the atomic-payment submission. Pick the new "Weather + currency"
  example button on the dashboard to try it.
- **Quality gate.** Before any agent is even asked for a price, the router quietly runs each one
  for free and has an AI judge check the output is actually good. There's also a manual override
  for reliable live demos (force pass / force fail — either for everyone, or targeted at one
  specific agent).
- **Stake + slash — the "wow" feature.** One agent (formatter) has its own dedicated stake wallet
  that the router controls. If that agent's answer fails the quality check, it gets paid nothing
  and its stake pays a rebate straight to the user instead — in the *same* single transaction as
  everyone else's normal payment. **Ran for real** — formatter got nothing, the user got a real
  0.5 USDC rebate, the other agents got paid normally, all in one confirmed group.
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
- **Demo rehearsal and slides** — not started yet, now unblocked (we have real proof to show,
  for both the atomic-payment case and the weather/currency case).
- **A clean "clone the repo and run it" test** — making sure someone starting from scratch can
  get it running without hitting the setup snags we already worked through.

## 3. What's being worked on right now

Nothing is actively mid-task. The most recent milestone: adding the weather and analysis agents
(restoring Zaid's original weather/currency/analysis idea inside the atomic-payment submission),
fixing three real bugs that surfaced from combining weather+currency in one task, and proving
real settlements for both the pure-weather and combined cases. Next up: wiring real user-facing
payment onto the "Route" button, and starting demo/slide prep.

## 4. What was ported from Zaid's `reference-implementation/`

| From reference-implementation | Into BV_UncZ, as | Why |
|---|---|---|
| Full "pay → get challenged → sign → retry → success" client flow | `BV_UncZ/client/` | `BV_UncZ`'s router pays agents directly and never ran the full client-side payment flow end to end — this proves that flow really works. |
| Groq-powered research answers | Research agent's real content | Was a placeholder before; now produces real, sourced findings. |
| Groq-powered writing/summarizing | Writer agent's real content | Same idea — real synthesis instead of a placeholder. |
| Live currency-conversion logic | Formatter agent's real content | Replaced a chart that didn't mean anything with real, live exchange-rate conversions. |
| Live weather-lookup logic (`weatherAgent.ts`) | New weather agent (port 4004) | Ported near-verbatim — same location-extraction + Open-Meteo lookup, now a real paid agent in the atomic group instead of unused. |
| Weather/currency narrative-synthesis idea (`analysisAgent.ts`) | New analysis agent (port 4005) | New code filling the same role — ties together whatever weather/currency data ran into a short plain-language answer. |
| "Preview without paying" idea | `/debug/preview` route + dashboard button | Lets anyone see real agent output without needing test money — good for demos. |
| Automatic agent-selection using Groq | `router/selectAgents.ts` | Same technique Zaid used to figure out what a user's task needs — now decides which of the 5 paid agents the router should even bother calling. |

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

No test-money needed for most of these — they fail (correctly, on purpose) at a step before
money would move:

- **A bad/low-quality answer → no payment**: `curl -X POST http://localhost:4000/admin/quality-gate/fail`, then try routing anything. Reset with `.../auto`.
- **A bad answer from specifically the staked agent → it gets slashed, others still get paid**: `curl -X POST http://localhost:4000/admin/quality-gate/target/formatter`, then route a currency task. Reset with `.../target-clear`.
- **One agent goes down mid-task**: `curl -X POST http://localhost:4000/admin/kill/writer`, then try routing anything. Reset with `.../admin/revive/writer`.
- **Spending limit too low**: route a currency task with a tiny `maxSpend` (e.g. `0.01`) — it refuses before signing anything.
- **Prove the anti-replay guard**: `curl -X POST http://localhost:4000/self-test/replay -d '{"agent":"research","n":6}'` — watch exactly 1 of 6 identical attempts get accepted.
- **Try the weather agent**: click the "Weather + currency" example button on the dashboard, or type something like "whats the weather in tokyo" — this now runs (and, with funded wallets, actually settles) end to end.

Full commands and expected output for each: [`explainer.md` §15](explainer.md#15-how-to-test-the-different-scenarios).

---

## How to run it

```bash
cd BV_UncZ
npm install
cd pera_wallet_setup/scripts && npm install && cd ../..
# .env.wallets at repo root needs USER/ROUTER/ROUTER_FEE/AGENT1-5 _ADDR + _MNEMONIC
# + GROQ_API_KEY (optional — router falls back to using all agents if missing)
npm run dev:research    # port 4001, $0.03
npm run dev:writer      # port 4002, $0.02
npm run dev:formatter   # port 4003, $0.01
npm run dev:weather     # port 4004, $0.02
npm run dev:analysis    # port 4005, $0.02
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
