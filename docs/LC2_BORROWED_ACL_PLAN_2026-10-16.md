# LC2 borrowed ACL controller — proposed boundary

Design accepted for UNWIRED source/Fake preparation by independent SolHigh, P1/P2/P3=0. Session prerequisite source/Fake Gate completed separately; controller implementation has its own validation record LC2_ENVELOPE_ACL_VALIDATION_2026-10-16.md. Not a production integration PASS. LC2 member writes remain UNWIRED. Remote PAUSED. Existing owner/default publication/store/crash/capacity Gates are not changed.

## First prerequisite: session drain semantics

Before a borrowed controller, harden only the dedicated UNWIRED WhitelistAclSession close path. Existing5000ms query,40s lifetime,64query/64KiB transport and ACL rules remain unchanged. No shared auth verifier/default store or native inspector script change.

Publish the shared close Promise before invoking side effects, so synchronous stdin/kill callbacks cannot recursively start a second close. Accept an optional absolute monotonic cleanup deadline only when it shortens the original5000ms drain. Invalid, expired or extending deadlines fail closed before dispatching stdin EOF or a kill. Such rejection does not establish native close or cancel an existing query: keep the original pending query timer and40s lifetime supervision until actual close, reject new admission and never grant a second drain window. A normal shortened drain still requires actual close and preserves primary failures. Late close may establish physical exit but cannot rehabilitate the rejected close result.

Fake cases must cover synchronous close reentry, invalid/extended/expired deadlines, shared shortened budget, synchronous EOF cost, query/lifetime supervision after an expired drain and actual close clearing timers. Existing real inert parser/pipe tests remain applicable; no native owner probe rerun is implied. Separate source/delta review and affected checks are required.

## Borrowed controller: later independent candidate

The smaller first implementation is a dedicated one-shot WhitelistEnvelopeAclAction(owner,root,trustedTestFactory?) that internally creates the sole envelope. Only inside its active body does it capture the exact owner's native wrapper and create a private controller. The callback receives a frozen four-method ACL facade, never the owner, capability, wrapper or factory. No public borrowed-proof or lease-bypass function is introduced. A trusted private failure hook calls that sole envelope.cancel synchronously on every controller failure, including malformed input or snapshot failure before any session exists; a body catch cannot restore admission. No raw error is retained. This is cancellation/poison only, never an unlock/retry permission.

Each successful session result is retired only after actual close and all of its raw query promises settle. Cleanup can reject the lifetime result to record primary failure while separately checking physical drain. Normal wrapper completion first requires no unawaited query, then quiesce and tracked resource retirement. The wrapper cannot return success while its idle child is open. A rejected close may still provide physical exit proof for a failed action; unknown close or raw query settlement retains the owner. Constructor throw after registration remains unknown, never guessed as no child.

Do not reuse WhitelistAclScope.run inside WhitelistActionEnvelope: it takes a second non-reentrant mutation lease. Do not pass an alreadyLocked boolean or fabricate an owner that pretends acquisition succeeded. Do not modify public store methods to skip their real lock.

The eventual controller must bind an opaque capability to the exact active envelope, owner/root identity, mutation epoch and ALS context. It must not return raw owner proof, release functions, paths or a public token. Test-only constructor injection cannot become a request/environment switch.

Each session creation attempt is registered before factory invocation. A pooled session is a lifetime resource: its successful result settles only after actual native close, not after its latest query reply. Queries have their own promises and unchanged5000ms deadlines. An idle open session is still an active resource. Do not relax resource seal to accept it. A trusted controller wrapper must await explicit idle quiesce and resource retirement before returning the body result. Unawaited queries or unknown construction poison the action; cleanup success does not turn it into success.

Healthy rotation preserves32query/20s thresholds,64query/40s child ceiling,262144 combined query/child accounting and fixed SID across sessions. Quiesce closes only ACL children; it never releases the action's mutation/activity lease. Failures do not retry or replace a failed child. Body failure, query failure and drain evidence remain distinct. Final action cleanup shares one outer absolute5s deadline across all resources; no per-session reset.

Existing stores stay unchanged until a separate scoped-entry design is accepted. Every descriptor, canonical path, link count, identity, exact-byte/hash and before/after ACL check must remain. Every publication must eventually be tracked with retained owner handles and Node I/O settlement; this controller alone cannot close publication ownership P2.

## Future integration gates

Session drain source/Fake Gate → exact borrowed-capability design/review → controller Fake boundary tests → isolated real ACL/rotation proof → separately reviewed scoped store/publication migration → physical capacity/crash/default validation → fresh full regression/review. No member API/RCON or real-server operation follows automatically from any intermediate Gate.
