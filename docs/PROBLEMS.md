# Problems Log

Every real problem hit while building `server/`/`client/`, in the order encountered, with root
cause and fix. Not a design-decision log — only things that were broken, surprising, or cost
time to diagnose. Format borrowed from `BV_UncZ-master/docs/PROBLEMS.md`.

---

## Environment setup

### 1. Node.js wasn't installed on the machine at all

**Symptom:** `node`/`npm` not found in either Bash or PowerShell.

**Fix:** installed via `winget install OpenJS.NodeJS.LTS`. Confirmed `node --version` /
`npm --version` afterward.

**Lesson:** the host process's environment predates the install, so new PATH entries from
winget don't reach already-running shell tool sessions — each command needed
`$env:PATH = [System.Environment]::GetEnvironmentVariable(...)` prepended to see `node`/`npm`
at all, for the rest of the session.

### 2. `npm install -g @algorandfoundation/algokit-cli` doesn't exist

**Symptom:** `npm view @algorandfoundation/algokit-cli` → `404 Not Found`.

**Cause:** `algokit-cli` is a Python package, distributed via `pip`/`pipx`, not npm — the
command as originally given was for a package that was never on the npm registry.

**Fix:** `pip install --user algokit` instead. Confirmed working via `algokit dispenser login`.

---

## Facilitator mismatch

### 3. Default facilitator (`x402.org/facilitator`) doesn't support Algorand under this SDK's network string

**Symptom:** `RouteConfigurationError: Facilitator does not support scheme "exact" on network
"algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="` at server startup.

**Cause:** `x402.org/facilitator`'s `/supported` endpoint advertises Algorand testnet under a
**truncated 32-char** CAIP-2 reference (`algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe`), while
`ALGORAND_TESTNET_CAIP2` exported by `@x402-avm/avm@2.6.1` is the full, untruncated 44-char
genesis hash. The two don't match, so route validation against that facilitator fails outright.

Confirmed independently later: your friend's `BV_UncZ-master/docs/PROBLEMS.md` documents the
exact same truncation pattern, in `@x402/avm@2.21.0` against the same facilitator — same root
cause, different package family, different day. Not a one-off fluke.

**Fix:** switched `FACILITATOR_URL` to `https://facilitator.goplausible.xyz`, confirmed via its
own `/supported` endpoint that it lists the exact, untruncated network string our SDK version
generates.

**Lesson:** don't trust a "default facilitator URL" from documentation/plan without checking
that specific facilitator's `/supported` endpoint against the specific SDK version installed —
the CAIP-2 string is a moving target across facilitator deployments.

---

## Wallet funding

### 4. Testnet ALGO dispenser (`bank.testnet.algorand.network`) reported "success" but nothing landed on-chain

**Symptom:** dispenser UI showed a success message; `testnet-idx.algonode.cloud` showed **zero
transactions ever** to the target address.

**Cause:** the dispenser's rate limit is almost certainly IP-based, not address-based — a prior
request from the same network had already exhausted it, and the UI's generic confirmation
fired regardless of whether the transfer actually queued.

**Fix:** used AlgoKit's official dispenser instead (`algokit dispenser login` + `algokit
dispenser fund`) — separate infrastructure, separate quota, worked immediately for the same
address.

### 5. AlgoKit's own dispenser then hit its own daily cap

**Symptom:** `Error: Limit exceeded. Try again in ~24.0 hours` on the second `algokit dispenser
fund` call, for a different address.

**Cause:** the daily limit is tied to the logged-in dispenser account, not the destination
address — one funded wallet used up the day's quota for all future funds via that route.

**Fix:** funded subsequent wallets by transferring small amounts (0.5 ALGO) directly from the
first funded wallet instead of hitting the dispenser again — wallet-to-wallet transfers aren't
rate-limited.

### 6. Circle's testnet USDC faucet said "Tokens sent" but nothing arrived for a long time

**Symptom:** UI confirmed success; on-chain balance stayed at 0 for well over 10 minutes;
indexer showed no transactions at all to the address.

**Cause (best evidence, not fully certain):** the destination wallet wasn't yet opted into the
USDC ASA (`10458941`) at the time of the request. Once we opted it in directly (a separate,
manual step) and retried the *same* faucet request, it does not appear to have been purely
about opt-in status either, since a fresh un-opted-in address funded via Circle's faucet
*did* eventually succeed elsewhere in the session — timing/queueing on Circle's backend is the
more likely explanation. Recorded as unresolved-with-workaround rather than a confirmed root
cause.

**Fix:** no reliable programmatic fix found. Workaround: opt the wallet in first, retry the
faucet request, and be prepared to wait — sometimes several minutes — before concluding it
failed.

**Lesson:** a "success" message from a Web2 faucet UI is not proof of an on-chain transfer;
always verify against the indexer/algod directly before treating a wallet as funded.

---

## Intent extraction bugs (regex era, before the Groq-based rewrite)

### 7. Location extraction required a capitalized word — lowercase input silently used the wrong city

**Symptom:** `"what is the weather in berlin"` (lowercase) returned London's weather with no
error — the location regex (`[A-Z][a-zA-Z]*`) simply didn't match lowercase "berlin" and fell
through to the default location.

**Fix:** made the preposition-based match case-insensitive.

### 8. Fix for #7 immediately overcorrected — two-word capture grabbed trailing filler words

**Symptom:** after the case-insensitive fix, `"berlin weather"` and `"tokyo please"` started
resolving to `"Berlin this"` / `"tokyo please"` respectively — geocoding failures — because the
new regex allowed an optional second captured word unconditionally.

**Fix:** reverted to single-word capture only; multi-word city names are handled by the later
Groq-based extraction instead (see below), not by regex.

### 9. No-preposition phrasing ("berlin weather") still fell through to the default

**Symptom:** `"berlin weather"` has no `in/at/for/to` before the location at all, so the
preposition-only regex never matched it — silently defaulted to London again.

**Fix:** added two more fallback patterns (word immediately before/after the literal word
"weather"), each guarded by a stopword list to avoid false positives like `"the weather"` or
`"check weather"`.

### 10. Currency amount regex matched a stray comma before the real number

**Symptom:** `"...check the weather, convert 50,000 rupees..."` parsed as `amount: 0`.

**Cause:** `/([\d,]+(?:\.\d+)?)/` allows a match consisting of a single comma character (no
digit required), and the comma right after `"weather,"` — appearing earlier in the string than
`"50,000"` — won the leftmost-match race.

**Fix:** required the match to start with an actual digit: `/(\d[\d,]*(?:\.\d+)?)/`.

**Lesson on 7–10 together:** four regex bugs in one afternoon, each fixed in isolation, is a
pattern — brittle hand-rolled NLP heuristics keep finding new edge cases one at a time. This is
what motivated replacing the regex approach with a single Groq-based structured-extraction
call (`router/llmExtractor.ts`), with the regex logic kept only as an automatic fallback for
when Groq is unavailable. The Groq version correctly handles cases regex structurally could
not, e.g. multi-word city names like "New York", without any of the above special-casing.
