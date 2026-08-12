# Problems Log

## Post-Phase-4 — Lora explorer link 404s

**Symptom:** the group ID link shown in the UI and returned by `/route`
(`https://lora.algokit.io/testnet/group/<groupId>`) — CLAUDE.md's own `EXPLORER_GROUP_URL`
constant — 404s with `Error: No route matches URL "/testnet/group/<groupId>"`. Reported by
the user after clicking a real link from a completed run.

**Cause:** Lora doesn't route transaction groups by group ID alone. Confirmed by navigating
to a known-good transaction page (`/testnet/transaction/<txId>`) for one of our own settled
payouts, which rendered fine and included a clickable "Group" field — clicking *that* link
(rather than guessing) revealed the real route: `/testnet/block/<round>/group/<groupId>`.
The confirming round number is a required path segment, not optional.

**Fix:** `shared/constants.ts` now exports `explorerGroupUrl(confirmedRound, groupId)`
instead of a static `EXPLORER_GROUP_URL` prefix; `router/settle.ts` builds the link from
both values it already has after `composer.send()`. Verified against Lora live: the new URL
renders the full "Transaction Group" page with all 4 transactions, correct fee, and the same
group ID — not just a 200, the actual right page.

**Lesson:** CLAUDE.md's constant block was never verified against the live site when it was
written into the spec — same category as the earlier CAIP-2 truncation issue, but this time
in hardcoded documentation rather than an npm package. Left CLAUDE.md itself unedited (it's
the working agreement, not something to silently rewrite) and fixed it in code + here.

---

## Phase 4 — Minimal UI

No backend/UI code problems. One testing-methodology gotcha worth recording anyway: while
manually clicking through the UI in a real browser to verify it (not just curling the API),
the "Revive" button appeared totally unresponsive — clicking it did nothing, and the
`writer` agent's own `/health` kept reporting `"killed": true` afterward. Root cause was in
the testing tool, not the app: the browser screenshot resolution (1568×746) didn't match
the actual page viewport (1422×677), so pixel coordinates read off the screenshot and fed
back into a click landed in the wrong place. Switching to clicking the button by its
accessibility-tree element reference (rather than raw x/y pixels from a screenshot) fixed
it immediately, and `/health` confirmed `"killed": false` right after. Recorded because the
symptom ("button does nothing") looks exactly like a real dead-click bug and could easily
be misdiagnosed as one on a future pass — the real check is always the server's own state
(`/health`), not just whether the UI label changed.

---


Every real problem hit during the build, in the order encountered. Not a design-decision
log — only things that were broken, surprising, or cost time to diagnose. See CLAUDE.md
§9 ("Known failure modes") for the condensed version meant for the README.

---

## Phase 1 — Three agent services

### 1. `@x402/avm` drifted to a broken version under caret ranges

**Symptom:** every `POST /work` on all three agents returned `500 Internal Server Error`
instead of `402 Payment Required`, with this in the server log:

```
RouteConfigurationError: x402 Route Configuration Errors:
  - Route "POST /work": Facilitator does not support scheme "exact" on network "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe"
```

**Cause:** `package.json` declared `"@x402/avm": "^2.12.0"`. A plain `npm install` resolved
that to `2.21.0`, and `2.21.0`'s exported `ALGORAND_TESTNET_CAIP2` constant is truncated to
`"algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe"` (41 chars) — missing the `xi9/cOUJOiI=` suffix.
The live facilitator (`facilitator.goplausible.xyz/supported`) only advertises the full
54-char string `"algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="`. `@x402/core`'s
`x402ResourceServer.initialize()` cross-checks configured routes against the facilitator's
supported list at startup-of-first-request and throws when they don't match — every request
500'd before it ever got the chance to issue a 402.

The reference project's own `package-lock.json` had resolved the same `^2.12.0` range to
exactly `2.12.0` (installed earlier, before `2.21.0` existed or before this repo's install
ran), which has the correct full constant. Diffing the two node_modules trees is what
surfaced this.

**Fix:** pinned `@x402/avm`, `@x402/core`, `@x402/hono` to exact `2.12.0` (no caret) and
`@x402-avm/extensions` to exact `2.6.1` in every package.json. Full `rm -rf node_modules
package-lock.json` + reinstall to confirm the resolution actually stuck (see problem #2 —
the first reinstall attempt silently didn't).

**Time cost:** ~20 minutes (isolating that it was a version issue, not a code issue, took
a scratch reproduction outside the workspace to rule out a monorepo-hoisting cause).

---

### 2. First reinstall attempt didn't apply the pin — stale lockfile/tree survived a `rm -rf`

**Symptom:** after editing all four `package.json` files to pin exact versions and running
`rm -rf node_modules package-lock.json ... && npm install`, `npm ls @x402/avm --workspaces`
still showed `2.21.0` installed and flagged it `invalid` (declared `2.12.0`, got `2.21.0`).

**Cause:** the three agent dev servers (`tsx watch`) were still running in the background
from Phase 1 verification when the first `rm -rf` + reinstall ran. On Windows, a `taskkill`/
PowerShell `Stop-Process` attempt against them exited non-zero (255) *before* the `rm -rf`
line executed in the same script, so it's likely the processes (or Windows file handles
left over from them) weren't fully gone yet, and `rm -rf` didn't fully clear
`node_modules` — npm then partially reused what survived.

**Fix:** explicitly verified deletion with `ls node_modules` / `ls package-lock.json`
(both returned "No such file or directory") *before* re-running `npm install`, rather than
trusting the `rm -rf` exit code. Second install resolved cleanly to `2.12.0` everywhere.

**Lesson:** on Windows, a killed Node process can hold file handles open briefly after
`taskkill` returns; don't chain `rm -rf` and `npm install` in one shot without confirming
the delete actually landed.

---

## Phase 3 — Redeem, verification, failure path

No code-breaking problems this phase. Built on top of the already-pinned dependency set
(no new npm packages needed — the indexer lookup is a plain `fetch`, not a new SDK), and
the `intra-round-offset` field returned by `testnet-idx.algonode.cloud` was confirmed via a
direct curl against the Phase 2b settlement's real group ID before writing any verification
code, rather than assumed — it maps 1:1 to the index used when building the group
(0/1/2 for the three agents, 3 for the fee-payer), which is what makes agent-side
`X-PAYMENT-INDEX` verification possible without the agent trusting the router's word for it.

All four Phase 3 claims were verified live, not just by reading the code back:
- **Redeem pipeline:** full `/route` call returned `phase: "REDEEMED"` with each agent's own
  `verifiedTxId` in its output, plus `X-Group-Id` / `X-Explorer-Url` in both the response
  body and response headers.
- **Agent doesn't trust the router:** called research's `/redeem` with writer's index (1)
  instead of its own (0) — got back `402` with `"wrong receiver: expected <research addr>,
  got <writer addr>"`. The agent caught a mismatched proof on its own, from the indexer,
  not from anything the router asserted.
- **Replay guard:** re-sent the exact same `X-PAYMENT-GROUP`/`X-PAYMENT-INDEX` that had
  already been redeemed — got `409 Conflict` on the second attempt.
- **Kill switch:** `POST /admin/kill/writer` via the router's proxy, then `POST /route` —
  `502` with `"Liveness check failed before any money moved"` and `zeroSpend: true`;
  `check-balance.ts` confirmed all five wallet balances were bit-for-bit unchanged
  afterward. Revived and confirmed normal operation resumed.

---

## Phase 2b — Atomic group composition and settlement

### 3. CLAUDE.md's `AtomicTransactionComposer` doesn't exist as a top-level export in installed `@algorandfoundation/algokit-utils@9.2.0`

**Symptom:** none yet at code level — caught by reading type declarations before writing
code, per CLAUDE.md's own "ground yourself... verify, don't assert" rule.

**Cause:** `@algorandfoundation/algokit-utils@9.2.0` (the version already installed and
proven working in `pera_wallet_setup/scripts`) does not export a class literally named
`AtomicTransactionComposer` from its root `index.d.ts`. That name is `algosdk`'s own class
(`algosdk.AtomicTransactionComposer`), which algokit-utils uses *internally* but doesn't
re-export. What algokit-utils exposes as its own idiomatic wrapper is `TransactionComposer`
(via `AlgorandClient.newGroup()`), which composes/groups/signs/sends transactions the same
way (`addAssetTransfer`, `addPayment`, `.send()` → `{ groupId, txIds, confirmations }`).
CLAUDE.md's wording most likely describes an older algokit-utils release's API surface.

**Fix:** used `AlgorandClient.newGroup()` / `TransactionComposer` instead of trying to
import a symbol that isn't there. This still satisfies CLAUDE.md's actual constraint —
"algosdk is no longer a [direct] dependency" — `algosdk` is not added to `router/package.json`;
only `@algorandfoundation/algokit-utils` is, matching the exact `9.2.0` pin already proven
to work in this repo's wallet-setup scripts.

### 4. Root `node_modules/@algorandfoundation/algokit-utils` resolved to `10.0.0-alpha.46`, not the pinned `9.2.0` — looked like the Phase 1 bug again, wasn't

**Symptom:** after adding `"@algorandfoundation/algokit-utils": "9.2.0"` to
`router/package.json` and running `npm install`, `require(...).version` at the repo root
printed `10.0.0-alpha.46`.

**Cause, this time genuinely benign:** `@x402/avm@2.12.0` itself transitively depends on
`@algorandfoundation/algokit-utils` at a range that resolves to the `10.0.0-alpha.46` line.
Since the root can only hoist one version and that transitive requirement got there first,
npm correctly nested a *second*, private copy at `router/node_modules/@algorandfoundation/
algokit-utils@9.2.0` for the router workspace specifically. Node's module resolution always
checks the closest `node_modules` first, so anything importing from inside `router/` gets
`9.2.0` as declared — confirmed with `require('./router/node_modules/@algorandfoundation/
algokit-utils/package.json').version`. No fix needed; this is npm workspace nesting working
as intended, not a repeat of problem #1. Recorded because it produces the exact same
"installed version ≠ declared version" symptom at the root that problem #1 did, and would
cost time again if re-diagnosed from scratch — the distinguishing check is whether the
*consuming package's own* `node_modules` (not the root's) has the right version.

### 5. `AlgoAmount` the class is not exported from the package root — only lowercase factory functions are

**Symptom:** `TypeError: Cannot read properties of undefined (reading 'MicroAlgo')` at
`settle.ts:101`, thrown on the first real settlement attempt (budget/size gates had already
passed, so this was mid-build of the atomic group, before anything was signed — no funds
moved).

**Cause:** the `AlgoAmount` class with static methods (`.MicroAlgo()`, `.Algo()`, etc.) is
real and does exist in this package, but it lives at `@algorandfoundation/algokit-utils/
types/amount` and is used internally by `composer.d.ts` — it is **not** re-exported from
the package root's `index.d.ts`. The root's own `amount.d.ts` (a different file, despite
the same name, living directly under the package root rather than under `types/`) only
exports lowercase **factory functions** — `algo()`, `algos()`, `microAlgo()`,
`microAlgos()`, `transactionFees()`, `ALGORAND_MIN_TX_FEE` — plus a `declare global` block
that patches `Number.prototype`/`BigInt.prototype` so `(1000).microAlgo()` also works
(that's what the JSDoc examples in `composer.d.ts` were actually demonstrating — not a
static class method). Confirmed at runtime: `require('@algorandfoundation/algokit-utils').
AlgoAmount` is `undefined`; `.microAlgo` is a function that returns a real `AlgoAmount`
instance.

**Fix:** import and call `microAlgo(n)` instead of `AlgoAmount.MicroAlgo(n)`.

**Lesson:** two files can share a name (`amount.d.ts` at package root vs. `types/amount.d.ts`)
and export completely different surfaces for the same underlying class — reading one and
assuming it describes the other is exactly the "invent function names" trap CLAUDE.md's
rule #1 warns about, just one level deeper (inside a *dependency's* type declarations, not
just the x402 reference docs). The fix was to verify with a one-line `node -e` runtime
check against the actual installed package before writing more code, not to keep guessing
from `.d.ts` content alone.

---

## Phase 2a — Router quote phase

No code-breaking problems this phase — `decodePaymentRequiredHeader` from `@x402/core/http`
(found by reading `reference/x402-starter/402-demo-client/index.ts` and the `@x402/core`
type declarations) decoded the agents' 402 headers correctly on the first try, and the
pinned versions from Phase 1's fix carried over cleanly when `router` was added as a new
workspace (`npm ls @x402/core --workspaces` stayed at `2.12.0` after `npm install`).

One non-problem worth recording so it isn't mistaken for one later: to verify the liveness
gate for real (not just trust the code), the formatter agent was killed mid-session via its
Windows PID (`Stop-Process`). `POST /route` correctly returned `502` with
`"Liveness check failed before any money moved"` and `zeroSpend: true`, and research/writer's
quotes were discarded rather than partially returned. Restarting the formatter agent and
re-querying `/route` recovered to the full `$0.06` total with no residual state — confirms
the quote phase has no cross-request memory to worry about (relevant later for the replay
guard in Phase 3, which is expected to be the first place real state gets introduced).
