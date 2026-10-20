# LC2 D2a — unconnected control frame component

Status: LOCAL SOURCE REVIEW PASS, not complete D2 and not native/capacity PASS.

The new `whitelist-compiled-control.ts` contains only pure UTF-8/canonical JSON
control-frame parsing, one-generation observation ledger and a planned explicitly
owned handle inventory. It imports no filesystem/process launcher and is not
referenced by production construction, routes, a default session or owner APIs.

## Contracts

The only frames are created, ready and terminal, bound to action nonce, artifact
digest, generation and process creation identity. Exact keys and literal version,
4096-byte control frame bound, strict UTF-8/LF and canonical JSON prohibit duplicate
keys, trailing frames, BOM, unknown fields and alternate scalar encodings.
Created precedes ready; terminal may follow created without ready for safe failure
cleanup. Only a ready generation with zero exit may have cleanGeneration=true.
That flag proves neither query success, native origin, handle safety nor action
success. Invalid/lost events poison the ledger; it cannot be reset/retried.

No parsed frame is a trusted native witness. D1's dedicated source-bound transport,
OS observations, outstanding-query accounting and deadline checks remain separate
prerequisites. No Node ChildProcess close event is fabricated by this component.

Handle plan: at most32 ancestors plus executable, two owner handles, three stdio
handles; max38 inherited handles. Initial plan counted86 bootstrap/38 worker;
final inventory adds owner-process and identity-token temporaries:88 bootstrap/40
worker explicitly owned handles within
fixed128/64 implementation caps. These are proposed application-owned handles,
not a claim that CLR/platform internals have those totals. Logical resources
bootstrap/pins/generation remain three of the original eight. Native enforcement
and exact ownership tables must still be implemented and reviewed.

## Retained failure and verification

First focused run: exit1, 50 PASS / 10 FAIL. Raw assertion excerpt:

```text
AssertionError: expected [Function] to throw error including 'ACL_CONTROL_UNSAFE' but got 'frames is not iterable'
Expected: "ACL_CONTROL_UNSAFE"
Received: "frames is not iterable"
```

LC2-D2A-FIXTURE-001, LOW, RESOLVED: Vitest it.each expands array rows into callback
arguments; the sequence fixture was wrongly treated as the whole array. Fix1 wraps
each sequence in an object; no assertion/deadline/product rule relaxed. Focused v2:
60 PASS/exit0. Added constructor/accessor and strict newline/zero identity cases;
final affected v2: 5 files /172 PASS /exit0, including existing action resources,
envelope, ACL session and32-script owner parity. Original first-run output remains
in conversation tool evidence; the excerpt above is not represented as a full
redirected log. Other logs are independent `test-results/lc2-compiled-control-*`.

Independent Sol High source review and final length/zero-identity delta review:
P1/P2/P3=0 for this component. No native tests were run. Full project regression
has not been rerun; historical 179 PASS/1 FAIL remains recorded separately.

Next: D2b choose and independently review same-host conservative monotonic deadline
mapping, internal one-shot admission and source-bound closure seams before their
pure implementation. D3 compiler/artifact trust/build and native execution stay
pending. LC2 capacity remains BLOCKED/member writes UNWIRED/remote PAUSED.
