# Real world activation acceptance preparation — 2026-10-26

Subsequent update: pre-execution signoff closed P1/P2/P3=0; real execution and
an independent OS startup observation have now run. See
[real activation results](./WORLDS_V2_REAL_ACTIVATION_2026-10-26.md). The following
pending statement and capacity interval are preserved historical preparation.

Status: PRE-EXECUTION REVIEW PENDING. Real harness has NOT RUN. Do not infer real
Minecraft loading acceptance from the completed synthetic UI/browser/OS tests.

## Authorized source preflight

The ignored standing authorization and current registration were read as UTF-8.
Observed: serverId vanilla-26-3, version26.3, registered root equals authorized
canonical root, source exists, JAR SHA-256 equals authorized observation, and
configured Java exists. No original world files were read or modified. An initial
PowerShell default-encoding JSON parse failed; the UTF-8 Node parse and identity
checks passed. The files themselves were not rewritten or repaired.

## Candidate

`tests/acceptance/worlds-v2-activation-real.mjs`

SHA-256:
`8de76cf1e81e60dade81b20baef29b7e5f0c9b34cd724e3a12ede4b05727da1a`

Syntax check and scoped ESLint: PASS, exit0. No product source was modified while
preparing this harness.

Planned authorized execution, only after pre-execution signoff:

    node --import tsx tests/acceptance/worlds-v2-activation-real.mjs --execute

The script creates a fresh UUID test-results directory after canonical/plain
ancestor and absence checks. It copies only the authorized JAR and already
accepted EULA. Java identity and actual major25/required25/high-confidence
Vanilla26.3 are checked before managed server startup. No new EULA acceptance.

It will generate/save a fresh original world, upload/import its actual files
through the folder-ZIP encoder and real API, prove inactive import, activate and
load the imported world, then return and load the original. It checks both
directions' dormant-world checksums. Three explicit managed server launches are
planned; no player authentication, other loaders, strict diagnostics, restic or
hot-backup acceptance is claimed. WARN/ERROR logs are retained, not waived.

Spawn is bound to exact executable/argv/cwd, shell=false/windowsHide=true. Logs
are bounded and redacted before publication. Cleanup joins only known children,
has bounded stop/kill waits and bounds Manager/adapter observer closure. Test
data, guards and failure evidence are retained; no deletion is implemented.

## Independent review state

GPT-6.1 Sol High reviewed the harness before any execution. Two P2 preflight
findings (target canonical containment and actual Java-version verification)
were fixed and independently confirmed closed. Its additional P3 concerned an
adapter created before Manager construction failing to close on a preflight
error. The writer fixed that path to close all current adapters when app is
absent, under the same bounded cleanup promise. Syntax/lint passed afterward.

The final independent delta call failed with:

    Selected model is at capacity. Please try a different model.

No substitute model or writer self-signoff was used. Final harness P1/P2/P3
signoff remains PENDING; this does not reopen or replace the completed prior
execution-UI slice review. No Java server was started by this preparation.

## Resume

Recheck this script fingerprint and obtain independent GPT-6.1 Sol High closure
of the final cleanup delta, then run the above authorized isolated acceptance.
Keep main activation default-off until its required real-loading and stage
acceptance conditions are satisfied. No user reauthorization is needed within
the standing test scope. P7 stays STOPPED; no Git publication is authorized.
