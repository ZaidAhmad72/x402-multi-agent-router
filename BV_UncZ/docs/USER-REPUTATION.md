# User Reputation

A persisted, 0–10 trust score attached to each user's own account
(`usersCollection.reputation`, `shared/types/user.ts`). Distinct from
`router/reputation.ts`'s abuse guard — see [Not the same thing as the abuse
guard](#not-the-same-thing-as-the-abuse-guard) below.

## Scale

- **Min: 0, Max: 10, Default: 8.**
- Every new registration (`router/auth.ts`) is seeded at `8`
  (`REPUTATION_DEFAULT` in `router/userReputation.ts`) — a new user starts
  trusted-but-not-maximally-trusted, with room to move in either direction
  from evidence, rather than starting at the ceiling or at zero.
- Existing users created before this field existed don't have it set. Every
  reader (`getReputation`, `applyReputationOutcome`, the admin page) falls
  back to the same default of `8` for a missing field, so an unset user
  reads and displays identically to a freshly-registered one until their
  first real event.

## The update rule

```
newRep = clamp(oldRep + alpha * (target - oldRep), 0, 10)
```

Every event pulls the score toward a `target` (10 or 0) by a fraction
(`alpha`) of the *remaining distance*, not by a flat amount. This is an
exponential moving average, and it's the direct answer to "use the existing
reputation as a parameter to calculate the new one": the same outcome moves
a user sitting at 9 by less than it moves a user sitting at 3, because
`(target - oldRep)` is smaller when you're already close to the target. That
produces two properties for free, without any extra logic:

- **A single event is never decisive.** One bad outcome can't cliff-drop a
  9 to 0, and one good outcome can't instantly launder a 1 back to 10.
- **A sustained pattern is decisive.** Repeated pulls toward the same target
  compound — a user who keeps succeeding drifts toward 10, a user who keeps
  getting rejected drifts toward 0 — geometrically, not linearly, so the
  score converges rather than oscillating forever.

## Outcomes that move the score

Only three outcomes touch reputation at all. Everything else is `NEUTRAL`
(no change) — see [What counts as neutral, and
why](#what-counts-as-neutral-and-why).

| Outcome | Target | Alpha | When |
|---|---|---|---|
| `SUCCESS` | 10 | 0.15 | The job settled **and** redeemed on-chain — a genuine, paid, completed request. |
| `QUALITY_REJECTED` | 0 | 0.25 | An unstaked agent's output was rejected by the quality gate before any payment — the task itself looked adversarial or too low-effort to produce a usable answer. |
| `GUARD_BLOCKED` | 0 | 0.4 | `router/reputation.ts`'s rate limiter fired on this request — the clearest available abuse signal, so it moves the score fastest. |

The asymmetry is deliberate: penalties use a bigger alpha than the reward.
Trust should erode faster than it's earned — a well-established property of
almost every real reputation system (credit scores, platform trust scores,
TCP congestion control's own AIMD backoff), and it means a user can't grind
their way back to 10 with throwaway successes after a real abuse signal.

### Worked example, starting from the default of 8

| Event | Calculation | New score |
|---|---|---|
| Start | — | 8.00 |
| `SUCCESS` | 8 + 0.15 × (10 − 8) | 8.30 |
| `SUCCESS` | 8.30 + 0.15 × (10 − 8.30) | 8.56 |
| `QUALITY_REJECTED` | 8.56 + 0.25 × (0 − 8.56) | 6.42 |
| `GUARD_BLOCKED` | 6.42 + 0.4 × (0 − 6.42) | 3.85 |
| `SUCCESS` | 3.85 + 0.15 × (10 − 3.85) | 4.77 |

Two quiet successes barely move the needle; one rejection costs more than
both of them combined; one guard block costs more than that. Climbing back
out after a block takes several genuine successes, not one.

## What counts as neutral, and why

Everything that isn't one of the three outcomes above leaves reputation
untouched:

- Network/Algorand-node connectivity errors (`algonode.cloud` outages)
- Insufficient testnet USDC / an agent wallet not opted into the USDC ASA
- `PLAN`'s transaction-slot limit check failing (task needs more than 16
  transactions)
- A redeem call failing *after* settlement already succeeded
  (`settledButNotRedeemed`) — money already moved; this is a router-side
  failure, not the user's

None of these are evidence the user did anything wrong — they're
infrastructure hiccups or honest misconfiguration (e.g. an under-funded
wallet). Moving the score on any of these would make it unfair and
unpredictable for a well-behaved user whose request just happened to hit a
bad moment for testnet infra. A trust score that can drop because of an
outage nobody could control isn't measuring trust.

## Where it lives, and how it updates

- **Storage:** `usersCollection` (MongoDB), same document `router/auth.ts`
  already creates for login — one extra field, no new collection.
- **Read:** `getReputation(username)` in `router/userReputation.ts`.
- **Write:** `applyReputationOutcome(username, outcome)`, called once at the
  end of each of the three outcome branches in `POST /route`
  (`router/index.ts`). It is **fire-and-forget** — not awaited by the
  request handler — so reputation bookkeeping can never add latency to, or
  fail, the user-facing response. Errors are caught and logged, never
  thrown.
- **Consequence of fire-and-forget:** the score isn't guaranteed to be
  updated by the time the `/route` response reaches the client. The
  frontend polls `GET /reputation/:username` on the same 3-second interval
  it already uses for wallet balances (`FRONTEND/src/pages/ChatApp.tsx`),
  so the displayed score converges to the true value within a few seconds
  rather than needing to be coordinated with the write.

## Categories

`categorizeReputation(score)` in `router/userReputation.ts` is the single
source of truth for score → label — both the sidebar and the admin page
call the same function (via `GET /reputation/:username`) rather than each
keeping their own copy of the thresholds.

| Range | Label | Shown as |
|---|---|---|
| 9 – 10 | Excellent | Consistently high-quality, legitimate usage. |
| 7 – 8.99 | Good | Reliable usage history. |
| 5 – 6.99 | Fair | Mixed history — some rejected or blocked requests. |
| 3 – 4.99 | Poor | Frequent rejections or rate-limit blocks. |
| 0 – 2.99 | Untrusted | Repeated abuse signals — requests may be restricted. |

A brand-new user at the default of 8 starts in **Good**.

## Where it's shown

- **Left sidebar, bottom** — both `UserView` (`UserSidebar.tsx`) and
  `DevView` (its chat-history overlay). Score + category badge, with the
  category description as a hover tooltip.
- **`GET /` (the router's root path)** — a simple, server-rendered,
  no-client-JS page listing every user and their reputation
  (`router/adminUsersPage.ts`), sorted highest first. No auth, matching
  every other admin endpoint in this repo (kill switch, quality gate
  override, guard on/off) — this is a shared testnet demo, and nothing
  sensitive is shown (never the password hash).

## Not the same thing as the abuse guard

`router/reputation.ts` (pre-existing) and this module answer different
questions and must not be confused:

| | `reputation.ts` (abuse guard) | `userReputation.ts` (this doc) |
|---|---|---|
| Identity | Salted hash of wallet address / session id | Logged-in username |
| Storage | In-memory `Map`, process-lifetime only | MongoDB, permanent |
| Resets | Every router restart | Never |
| Window | Rolling 10 minutes | All-time |
| Purpose | Block free-compute abuse *during* a burst | Long-term account trust, visible to the user |
| Effect | Hard block (`429`, request never runs) | Soft signal (displayed score; nothing is blocked by it today) |

A `GUARD_BLOCKED` event from the abuse guard is one of the three inputs to
*this* score (see the table above) — the two systems are connected, but
one is not a replacement for the other. The abuse guard still runs and
still blocks independently of what a user's persisted reputation says.
