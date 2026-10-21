# M2 dual-instance Node protocol integration

Run `m2-multi-protocol-05531041-3c54-4f23-8091-49aa99944b70`:
**PASS**, exit0. Evidence remains ignored under `test-results/<runId>/`.
Independent final evidence review: **P1=0, P2=0, P3=0**.

The harness `tests/acceptance/m2-multi-protocol.mjs` uses actual LT HTTP,
OperationService, LocalRuntimeFactory, Windows TCP ownership checks and two actual
Node child processes running `tests/fixtures/m2-protocol-child.mjs`.
Launch plans and game/RCON protocol responses are synthetic. This is explicitly
`NODE_PROTOCOL_FIXTURE`, `realMinecraft=NOT RUN`; it is not loader/JAR/EULA or
simultaneous real Minecraft acceptance.

- A and B run simultaneously on four distinct loopback ports.
- Same start idempotency key is independently scoped to each instance.
- A/B command responses and exact received command logs never cross instances.
- Restart A replaces only A's PID; B remains alive with its original PID.
- Replaying the original A start returns its original operation with no launch.
- Stop A leaves B's command channel usable, then B stops explicitly.
- Three launch generations (PIDs27400,3108,27924) each have game and RCON
  ownership proof among20 native observations. All close normally, exit0/null.
- finalStopped/helpersClosed/portsReleased=true; cleanupErrors=[];
  no diagnostic stdin cleanup. Historical evidence is retained.

Initial static validation failed before execution: missing closing brace in the
harness, `SyntaxError: Unexpected end of input`, ESLint parsing error. Attempt1
added the brace; syntax/lint/diff then passed. Original lint log remains at
`test-results/m2-multi-harness-lint.log`; corrected log is
`m2-multi-harness-lint-v2.log`. No product code, assertion, timeout or prior
evidence was changed to obtain this result. The actual protocol run occurred once.

This closes the dual-process protocol integration slice. Full M2 is still
IN PROGRESS pending remaining actual lifecycle evidence and applicable final
Gates. See [authorized Vanilla evidence](./M2_GAME_REAL_2026-10-21.md).
The known Perflib strict-diagnostics BLOCKED and historical whole-API failures
remain independent limitations. No old CommandStore experiments were run.
No commit/push/PR; P7 remains STOPPED.
