# Implementation Plan — Execution Plan DAG + Abuse Guard

Two independent features for `BV_UncZ/`. Written to be executed by Claude Code in order.

**Feature A — Abuse Guard** (`router/reputation.ts`) — deterministic, privacy-preserving counters that
close the free-compute hole in the quality gate. ~30–45 min.

**Feature B — Execution Plan DAG** (`router/plan.ts` + UI) — makes the already-working dynamic agent
selection visible as a dependency graph, and makes the planner group-size aware. ~60–90 min.

Do **A first** — it is cheaper and self-contained. If total available time is under 90 minutes,
**skip A and do B only**: B has the higher demo payoff.

---

## 0. Before writing any code

Read these files in full. Do not rely on this document's summaries of them — this document was
written from a snapshot and the working tree is the truth.

| File | Why |
|---|---|
| `CLAUDE.md` | The working agreement. Rule #1 (verify, don't assert) governs everything below. |
| `shared/constants.ts` | `AGENT_REGISTRY`, `AgentRegistryEntry`, `dependsOn`, `ROUTING_FEE_MICRO_USDC` |
| `router/index.ts` | `POST /route` phase order, error shapes, admin route patterns |
| `router/selectAgents.ts` | `selectAgents(task)` and its `withDependencies()` resolution |
| `router/qualityGate.ts` | `runQualityGate(task, registry)`, `QualityVerdict`, force-mode levers |
| `shared/replayGuard.ts` | The in-memory-store-with-TTL pattern to mirror |
| `ui/index.html` | Existing panels, `setPhase()`, `route()`, `renderX()` conventions |

### Hard constraints

1. **Do not add npm dependencies.** Both features are implementable with what is installed.
2. **Do not change any pinned version.** `@x402/*` stays at exact `2.12.0`. Do not run `npm update`.
3. **Do not touch the money path.** `router/settle.ts` group composition, the budget gate, and the
   group-size gate inside `settle.ts` must remain byte-identical in behaviour. Feature B adds an
   *earlier, advisory* forecast; it does not replace the authoritative gate in `settle.ts`.
4. **Everything fails open.** Any error in new code must log and continue with previous behaviour,
   matching the existing policy in `selectAgents.ts` and `qualityGate.ts`. A bug in a new feature must
   never block a route that would otherwise have settled.
5. **No new processes or ports.** Both features live inside the existing router.
6. **Everything must be demonstrable and reversible from the UI**, mirroring the kill switch and
   quality-gate force modes — a judge may want to trigger or disable it live.
7. **Log to `docs/PROBLEMS.md`** any surprise, wrong assumption, or API that did not exist as expected,
   in the existing format. This is part of the deliverable, not optional.

### Verification standard

For each acceptance criterion below: run it and observe the actual output. Do not mark anything done
by reading code back. `curl` the endpoint, click the button, check the counter moved.

---

# FEATURE A — Abuse Guard

## A.1 The problem being solved

`POST /route` calls `runQualityGate(task, registry)` **before** the quote phase. That trial-runs every
selected agent via its unprotected `/debug/preview` route, for free, before anyone is asked for money.
`POST /debug/preview` on the router does the same thing directly.

That is an **unpaid compute subsidy**. Anyone can burn agent compute indefinitely by submitting jobs
that never reach settlement — by exceeding `maxSpend`, by triggering a liveness abort, or by simply
hammering `/debug/preview`. Every one of those paths consumes real agent work and pays nothing.

A second, subtler vector: a user who repeatedly submits tasks engineered to make a *staked* agent fail
is **farming slash rebates** — each failure sends that agent's stake to the user's address. The
accountability mechanism can be turned into an income stream.

Both are concrete holes in our own design. Finding them ourselves is worth credit; the fix is cheap.

## A.2 Explicit non-goals

- **No ML model, no LLM classifier.** Deterministic counters with thresholds. An LLM here would be
  unexplainable, unjustifiable on false positives, and would require retaining the task text we are
  claiming not to retain.
- **No persistence.** In-memory only, same as the replay guard. A restart clears it. Say so.
- **No claim of Sybil resistance.** Identity is currently unverified — see A.3. Overclaiming this is
  worse than not building it.

## A.3 Identity, and an honest limitation

The key is derived from, in order of preference:

1. `userAddr` from the request body, if present
2. otherwise the `X-Session-Id` request header, if present
3. otherwise the literal string `"anonymous"` (a single shared bucket)

**Store `sha256(SALT + identity)`, truncated to 16 hex chars. Never store the raw identity.** `SALT` is
a module-level random value generated at process start — this means the mapping is not reversible even
by someone who reads the process memory dump later, and cannot be correlated across restarts.

> **State this limitation in the code comment and in the UI panel, verbatim:** identity is not
> cryptographically verified yet, so a determined abuser can rotate `userAddr` and reset their counters.
> The guard raises the cost of abuse; it does not prevent it. Wallet ownership proof (sign a nonce,
> verify the signature) is the prerequisite that would close this, and is deliberately out of scope here.

Being explicit about this is the difference between a defensible feature and a hollow one. Do not soften it.

## A.4 What is stored

```ts
interface UsageRecord {
  key: string;              // truncated salted hash — the ONLY identifier retained
  freeRuns: number[];       // timestamps of free trial runs (quality gate + /debug/preview)
  settled: number[];        // timestamps of jobs that reached a confirmed group
  aborted: number[];        // timestamps of jobs that consumed free work then failed to settle
  rebates: number[];        // timestamps of slash rebates received by this key
  flags: string[];          // currently-active flag names
}
```

Timestamp arrays rather than plain counters, so the window is a genuine rolling window and decay is
free — prune anything older than `WINDOW_MS` on every read. This is more explainable to a judge than a
decay constant, and simpler to implement correctly.

**Never store the task text, the agent outputs, the quality-gate reasons, or the raw address.** The
privacy claim must be literally true: the store contains counts and nothing else.

## A.5 Rules

Constants at module top, clearly named, easy to point at during Q&A. Suggested starting values —
tune them so the demo tasks pass comfortably:

```ts
const WINDOW_MS          = 10 * 60_000;  // 10 minutes
const MAX_FREE_RUNS      = 12;           // free trial runs per window
const MIN_RUNS_FOR_RATIO = 5;            // don't judge a ratio on tiny samples
const MIN_SETTLE_RATIO   = 0.2;          // settled / (settled + aborted)
const MAX_REBATES        = 3;            // slash rebates per window
```

| Flag | Condition | Action |
|---|---|---|
| `RATE_LIMIT` | `freeRuns.length >= MAX_FREE_RUNS` | **Block** — reject before any agent is called |
| `FREELOADING` | `settled + aborted >= MIN_RUNS_FOR_RATIO` and ratio `< MIN_SETTLE_RATIO` | **Warn** — log and surface in response, still allow |
| `REBATE_FARMING` | `rebates.length >= MAX_REBATES` | **Warn** — log and surface |

Only `RATE_LIMIT` blocks. The other two are advisory. Rationale to state in the code: a false positive
that refuses a paying user is worse than a false negative that lets one freeloader through, and the
warn-level flags are exactly the ones most likely to misfire on legitimate heavy testing.

## A.6 Module API — `router/reputation.ts`

```ts
export interface UsageVerdict {
  key: string;
  allowed: boolean;
  flags: string[];
  reason?: string;          // human-readable, safe to show the user
  counts: { freeRuns: number; settled: number; aborted: number; rebates: number };
}

/** Derive the pseudonymous key. Never returns the raw identity. */
export function usageKey(userAddr?: string, sessionId?: string): string;

/** Read-only check. Call BEFORE any free agent work. Must not mutate. */
export function checkUsage(key: string): UsageVerdict;

/** Record events. All are no-ops that swallow errors. */
export function recordFreeRun(key: string, count: number): void;   // count = number of agents trial-run
export function recordSettled(key: string): void;
export function recordAborted(key: string): void;
export function recordRebate(key: string): void;

/** For the UI panel. Returns pseudonymous keys and counts only. */
export function allUsage(): UsageVerdict[];

/** Demo levers, mirroring setQualityGateMode. */
export function setGuardEnabled(enabled: boolean): void;
export function isGuardEnabled(): boolean;
export function resetUsage(): void;
```

`checkUsage` returning `allowed: true` when the guard is disabled is the simplest way to wire the
toggle — do it there rather than at every call site.

## A.7 Wiring into `router/index.ts`

In `POST /route`, **after** `task`/`maxSpend` validation and **before** `selectAgents(task)`:

```ts
const key = usageKey(userAddr, c.req.header('x-session-id'));
const usage = checkUsage(key);
if (!usage.allowed) {
  return c.json({
    error: usage.reason,
    phase: 'GUARD',
    zeroSpend: true,
    usage,
  }, 429);
}
```

Then:

- After `runQualityGate(...)` returns → `recordFreeRun(key, registry.length)`
- On every existing early-return path that has `zeroSpend: true` → `recordAborted(key)`
- On the successful `phase: 'REDEEMED'` return → `recordSettled(key)`
- On the same success path, if any `settlement.perAgent` entry has `outcome === 'slashed'` →
  `recordRebate(key)`
- Include `usage: checkUsage(key)` in the `/route` success response body so the UI can render it

Apply the same guard check to `POST /debug/preview`, and `recordFreeRun` there too — it is the most
directly abusable route and it is currently wide open.

Add a new phase name `'GUARD'` to whatever the UI switches on. It sits before `QUALITY`.

## A.8 New routes

| Route | Behaviour |
|---|---|
| `GET /usage` | `allUsage()` — pseudonymous keys, counts, flags. No addresses, no task text. |
| `POST /admin/guard/:mode` | `mode` ∈ `on` \| `off`. Mirrors `/admin/quality-gate/:mode`. |
| `POST /admin/guard/reset` | `resetUsage()`. **Register this route before `/admin/guard/:mode`** — `reset` is one path segment and would otherwise be captured by `:mode`. The same footgun is already documented in `index.ts` around `target-clear`. |

## A.9 UI

New collapsed-by-default panel, styled like the existing Balances/Admin panels:

- Table: truncated key, free runs, settled, aborted, rebates, flags
- Guard on/off toggle showing current state, like the quality-gate status pill
- Reset button
- One line of static text stating the privacy property and the identity limitation from A.3

Refresh it after each `route()` completes, alongside `refreshBalances()`.

## A.10 Acceptance criteria

Run each. Observe the actual result.

1. Normal route with guard on → settles as before, `usage.counts.settled` increments by 1.
2. `POST /debug/preview` twelve times → the twelfth returns `429` with `phase: 'GUARD'`, and **no agent
   process logs a preview call for it**. Check the agent terminal, not just the router response.
3. `POST /admin/guard/reset` → `GET /usage` is empty; the next request succeeds.
4. `POST /admin/guard/off` → the same twelve requests all succeed. Toggle back on.
5. Force a budget-exceeded abort → `aborted` increments, `settled` does not.
6. Run the staked-agent slash demo → `rebates` increments by 1.
7. `GET /usage` contains no Algorand address, no task text, and no agent output anywhere in the response.
   Grep the raw JSON to confirm.
8. Kill the router, restart, `GET /usage` → empty. Confirms in-memory-only, as documented.

---

# FEATURE B — Execution Plan DAG

## B.1 The idea, stated precisely

`selectAgents(task)` already performs dynamic, capability-based agent selection and resolves transitive
`dependsOn`. **The dynamic tasking exists. It is invisible.** This feature makes it legible and makes it
group-size aware.

Two decisions that shape the whole implementation:

**No fixed complexity tiers.** An earlier sketch bucketed tasks into levels 1–4 by agent count. Cut it.
The boundaries are arbitrary with no principled defence, and with five agents in the registry the top
tier is unreachable — putting it on a slide invites "show me one." Report the plan's actual shape
instead: agent count, layer count, maximum parallel width. Those are facts.

**No second LLM call.** The DAG is derived deterministically from the `AgentRegistryEntry[]` that
`selectAgents` already returns. Zero added latency, zero new failure point in the hot path. This matters:
a five-minute demo cannot absorb another network round trip that might hang.

## B.2 The genuinely novel part — say this out loud in the pitch

The plan determines the atomic group size, and the group is hard-capped at 16 transactions. So the
planner is necessarily budget-and-group aware: it must produce a plan, forecast `N + 2` transaction
slots, and check that against the cap **before** anything is quoted or signed.

That closes a loop nobody else will have: **planning, pricing, and settlement are constrained by the same
primitive.** The 16-transaction limit stops being a limitation to apologise for in Q&A and becomes an
input to the planner.

## B.3 Module API — `router/plan.ts`

```ts
export interface PlanNode {
  name: string;
  description: string;
  dependsOn: string[];
  layer: number;             // 0 = no dependencies, runs first
}

export interface PlanEdge { from: string; to: string; }

export interface GroupForecast {
  agentTxns: number;         // = nodes.length
  routingFeeTxn: number;     // always 1
  feePayerTxn: number;       // always 1
  total: number;             // agentTxns + 2
  limit: number;             // 16
  headroom: number;          // limit - total
  withinLimit: boolean;
}

export interface ExecutionPlan {
  task: string;
  nodes: PlanNode[];
  edges: PlanEdge[];
  layers: string[][];        // agent names grouped by layer, in execution order
  shape: {
    agentCount: number;
    layerCount: number;
    maxParallelWidth: number;   // widest layer — the visible fan-out
  };
  groupForecast: GroupForecast;
}

/** Pure and synchronous. No network, no LLM, no mutation. */
export function buildPlan(task: string, registry: AgentRegistryEntry[]): ExecutionPlan;
```

### Layer assignment

Longest-path layering, not naive breadth-first: a node's layer is `1 + max(layer of its dependencies)`,
and `0` if it has none. Compute iteratively to a fixed point, mirroring the existing `withDependencies()`
loop style in `selectAgents.ts`.

Only count dependencies that are **present in the passed registry** — `selectAgents` returns a subset,
and a `dependsOn` entry pointing at an agent that was not selected must be ignored rather than crashing
or forcing a phantom layer. Verify this against the current registry: `formatter` declares
`dependsOn: ['writer']`, so a task selecting `formatter` without `writer` must still produce a valid plan.

**Guard against cycles.** The registry is hand-maintained and a future edit could introduce one. Cap the
fixed-point iteration at `registry.length` passes; if it has not converged, log a warning and flatten
every unresolved node to layer 0. Fail open — never throw.

## B.4 Wiring into `router/index.ts`

In `POST /route`, immediately after `const registry = await selectAgents(task)`:

```ts
const plan = buildPlan(task, registry);
console.log(`PLAN — ${plan.shape.agentCount} agents, ${plan.shape.layerCount} layers, ` +
            `max parallel width ${plan.shape.maxParallelWidth}, ` +
            `group forecast ${plan.groupForecast.total}/${plan.groupForecast.limit}`);
```

Include `plan` in **every** `/route` response — success and every error path alike. On an abort the plan
is the most useful thing in the response, because it shows what *would* have run.

If `!plan.groupForecast.withinLimit`, return early with `phase: 'PLAN'`, `zeroSpend: true`, and a message
naming the actual numbers and the chunking answer:

> Plan needs N+2 transactions, exceeding Algorand's 16-transaction atomic group limit. Nothing was
> quoted or signed. Beyond 16 the atomicity guarantee would have to hold per chunk rather than globally
> — see future scope.

This is unreachable with five agents. Build it anyway: it is three lines, and it converts a Q&A question
into a demonstrated behaviour.

> **Do not remove or weaken `GroupTooLargeError` in `settle.ts`.** The forecast is advisory and runs on
> the selected subset; the gate in `settle.ts` is authoritative and runs on what is actually about to be
> signed. Two checks at two layers is correct. Say this if asked why both exist.

## B.5 New route — `POST /plan`

```
POST /plan   { task: string }   →   { plan: ExecutionPlan }
```

Calls `selectAgents(task)` then `buildPlan(...)`. **Calls no agent, spends nothing, signs nothing.**

This is the single best demo affordance in either feature: a judge types any task and instantly sees the
architecture the system would use, with the transaction-slot forecast, at zero cost and with no testnet
dependency. **It works even if algonode is down** — which, per `docs/PROBLEMS.md`, is a live risk.

## B.6 UI

New panel above the phase indicator, visible after a plan is returned.

**Rendering approach: inline SVG.** No library — the repo has no frontend dependencies and must not gain
any. Layers become columns left to right; agents become boxes within a column; edges become lines
between boxes. Compute box positions from layer index and within-layer index. Keep it under ~80 lines.

Requirements:

- One column per layer, left to right in execution order
- Agents in the same column are visibly parallel — this is the fan-out, and it is the point
- Edges drawn from each dependency to its dependent
- A caption line: `N agents · L layers · max parallel width W · group forecast T/16 slots`
- Colour each node by outcome once the route completes: paid green, slashed red, pending grey. Reuse the
  existing `--muted` / status colour variables rather than introducing new ones.

Add a **Plan (no payment)** button next to the existing **Preview (no payment)** button, calling `POST /plan`.
This is what gets clicked during Q&A.

## B.7 Acceptance criteria

Run each against a live router.

1. `POST /plan` with `"whats the weather in tokyo"` → plan contains `weather` and `analysis`, not
   `research`/`writer`/`formatter`. Layers are correct.
2. `POST /plan` with `"whats the weather in berlin and convert 100 usd to eur"` → all five agents; the
   DAG shows `research → writer → formatter` as a chain and `weather` on layer 0 in parallel with
   `research`. Confirm `maxParallelWidth >= 2`.
3. `POST /plan` returns in well under a second and **no agent process logs any call**. Check agent
   terminals. This proves it is free.
4. Stop all five agent processes, then `POST /plan` → still returns a correct plan. Proves it has no
   runtime dependency on the agents being up.
5. Unset `GROQ_API_KEY` and restart → `selectAgents` falls back to the full registry, and the plan renders
   all five agents with correct layering. Nothing throws.
6. Full `POST /route` → the response contains `plan`, and the DAG nodes colour correctly against the
   settlement receipt.
7. Force the staked-agent slash demo → the slashed agent's node renders red while the others render green,
   in the same plan view.
8. Trigger a liveness abort by killing one agent → the response still contains the plan, showing what
   would have run.
9. Temporarily add a fake sixteenth entry to `AGENT_REGISTRY` in a scratch branch and confirm the
   `phase: 'PLAN'` early return fires with the correct numbers. **Revert this before committing.**

---

# Sequencing and stop conditions

1. **Feature A**, all acceptance criteria, then commit.
2. **Feature B** module + `/plan` route + acceptance criteria 1–5, then commit. *This is the point at
   which B is demo-viable even with no UI work.*
3. **Feature B** UI, acceptance criteria 6–9, then commit.

Stop conditions — a partially-built feature is worse than an unbuilt one:

- If Feature A is not passing its criteria within ~60 minutes, set the guard **default-off**, leave it
  wired, and move to B. It becomes a slide item rather than a demo item.
- If the SVG rendering in B.6 is fighting back after ~30 minutes, ship the plan as a **styled table**
  (columns: layer, agents in that layer) instead. The information is what matters; the graph is a bonus.
  A working table beats a broken graph.
- **Under no circumstances** commit a change that alters settlement behaviour to make either feature work.
  If a feature appears to require touching `settle.ts`, stop and reconsider the design.

# What to say about each in the pitch

**Plan DAG** — "Agent selection is dynamic, not hardcoded. The router decides which agents a task needs,
resolves their dependencies into an execution graph, and forecasts the transaction slots that graph will
consume — against Algorand's 16-transaction atomic group limit — before quoting anyone. Planning, pricing,
and settlement are constrained by the same primitive."

**Abuse guard** — "Our quality gate trial-runs every agent for free before anyone pays, which is an
unpaid compute subsidy we had to close. We track pseudonymous per-user counters — salted hashes, counts
only, no task content, no addresses retained — and rate-limit free runs. We also watch for slash-rebate
farming, because a user could otherwise engineer failures to harvest agent stakes. Agents already stake
and can be slashed; this makes accountability symmetric across both sides of the marketplace. The honest
limitation is that identity is not cryptographically verified yet — wallet ownership proof via a signed
nonce is the prerequisite, and it is our next milestone."
