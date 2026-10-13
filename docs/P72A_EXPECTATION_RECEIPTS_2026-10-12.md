# P7.2a-6 Immutable disabled-bootstrap expectations

Disabled bootstrap now publishes a private immutable provider receipt in the held Manager root before publishing the provider configuration. Receipt binds schema/provider, lock-proven root identity, Access directory identity, config revision and SHA256. Both receipt and config publication use same-directory no-replace primitives. Existing provider receipt cannot be overwritten or reinitialized.

Open remains read-only. All fixed provider stages in root or Access directory block reopening. Existing config without receipt, receipt without config, root/directory replacement, mismatched revision/hash, malformed receipt or ACL/identity drift fail closed. Existing old bootstrap files are not silently migrated: unsigned files reject. No default-reset, evidence deletion, automatic replay or network action occurs on uncertainty.

Receipts use fixed backend paths and contain no credentials, paths, sessions or CLI output. Reads compare private ACLs and file identity/content before/after, validate canonical bounded bytes and bind to current owner. This is an immutable disabled-only expectation format, not a mutable enabled-config ledger or remote-operation journal.

Adversarial deletion/replacement of all expectation evidence by the same user/administrator cannot be distinguished from absence without an external trusted anchor. This limitation is not claimed solved. Windows directory fsync/power-loss limits remain. The receipt protects retained-evidence missing/mismatched-record restart cases; it does not authorize enabled state or prove crash recovery.

Injected focused initial store/codec9 PASS/native0. Added interrupted-config-publication test preserves the already committed receipt and rejects reopen even when config staging is missing. Current focused/native/static results and independent review recorded in PROGRESS. Prior native1PASS62.77s predates receipt changes and is not reused as new candidate evidence.

Next: reviewed Manager-wide durable operation intent and explicit recovery state/service, plus fault tests. No startup/API integration, real remote capability, commit/push/PR or Minecraft/credential/system change.

Final candidate execution: production Windows native1 PASS/native0,total139.63s/body138.96s with receipt publication, owner reacquisition and no-replace collision. Final injected Access store/codec/inventory/recent-admission15 PASS. Isolated native fixture released/removed successfully; native/helper/ACL/concurrency limits unchanged. Independent Sol High readonly receipt review P1=0/P2=0/P3=0. No new failure or repair attempt. Final lint/typecheck/build/diff result recorded in PROGRESS. No full-suite regression run for this slice.
