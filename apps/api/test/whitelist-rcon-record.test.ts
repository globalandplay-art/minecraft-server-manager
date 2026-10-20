import { expect, it } from "vitest";
import { encodeWhitelistCommand, verifyWhitelistCommandChain, whitelistCommandHash, whitelistCommandRequestHash,
  whitelistRconEvidenceHash, type WhitelistCommandRecord, type WhitelistRconEvidence } from "../src/services/whitelist-command-record.js";
const request = { action: "add" as const, name: "Player_Two", revision: "a".repeat(64), confirm: true as const };
const first: WhitelistCommandRecord = { schemaVersion: 1, sequence: 0, previousHash: null,
  managerRootIdentity: "a".repeat(64), directoryIdentity: "b".repeat(64), operationId: "123e4567-e89b-42d3-a456-426614174020",
  serverId: "test", idempotencyHash: "c".repeat(64), requestHash: whitelistCommandRequestHash("test", request), request,
  serverRootIdentity: "d".repeat(64), runtimeId: "123e4567-e89b-42d3-a456-426614174021", guardReceiptHash: "e".repeat(64),
  state: "intent-persisted", responseHash: null, createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" };
const evidence: WhitelistRconEvidence = { rulesId: "vanilla-26.3-rcon-v1", response: "FAKE add Player_Two", runtimeNamesHash: "f".repeat(64),
  afterGuardId: "123e4567-e89b-42d3-a456-426614174022", afterGuardReceiptHash: "a".repeat(64) };
function next(prior: WhitelistCommandRecord, state: WhitelistCommandRecord["state"], patch: Partial<WhitelistCommandRecord> = {}): WhitelistCommandRecord {
  return { ...prior, sequence: prior.sequence + 1, previousHash: whitelistCommandHash(encodeWhitelistCommand(prior)), state, ...patch };
}
it("binds response evidence to the operation/request/runtime and preserves it through recovery", () => {
  const dispatch = next(first, "dispatch-intent"), response = next(dispatch, "response-recorded",
    { rconEvidence: evidence, responseHash: whitelistRconEvidenceHash(first, evidence) });
  expect(() => verifyWhitelistCommandChain([first, dispatch, response, next(response, "recovery-required")])).not.toThrow();
  expect(whitelistRconEvidenceHash({ ...first, runtimeId: "123e4567-e89b-42d3-a456-426614174023" }, evidence)).not.toBe(response.responseHash);
  const replacement = { ...evidence, response: "other" };
  expect(() => verifyWhitelistCommandChain([first, dispatch, response, next(response, "recovery-required",
    { rconEvidence: replacement, responseHash: whitelistRconEvidenceHash(first, replacement) })])).toThrow();
});
it("rejects evidence before a response and introduction directly into recovery", () => {
  const patch = { rconEvidence: evidence, responseHash: whitelistRconEvidenceHash(first, evidence) };
  expect(() => verifyWhitelistCommandChain([{ ...first, ...patch }])).toThrow();
  expect(() => verifyWhitelistCommandChain([first, next(first, "dispatch-intent", patch)])).toThrow();
  expect(() => verifyWhitelistCommandChain([first, next(first, "recovery-required", patch)])).toThrow();
});
