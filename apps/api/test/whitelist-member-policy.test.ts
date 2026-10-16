import { describe, expect, it } from "vitest";
import { compareWhitelistMemberEvidence, parseWhitelistMemberIntent, validateWhitelistMemberIntent, whitelistMemberRevision,
  type WhitelistMemberIntent, type WhitelistMemberSnapshot } from "../src/services/whitelist-member-policy.js";

const one = { name: "Player_One", uuid: "123e4567-e89b-42d3-a456-426614174000" };
const two = { name: "Player_Two", uuid: "123e4567-e89b-42d3-a456-426614174001" };
const before: WhitelistMemberSnapshot = { serverId: "test", rootIdentity: "a".repeat(64), configRevision: "b".repeat(64), fileIdentity: "c".repeat(64),
  fileSha256: "d".repeat(64), runtimeId: "123e4567-e89b-42d3-a456-426614174010", members: [one] };
const add = (): WhitelistMemberIntent => ({ action: "add", name: two.name, confirm: true, revision: whitelistMemberRevision(before) });
const after = (): WhitelistMemberSnapshot => ({ ...before, fileIdentity: "e".repeat(64), fileSha256: "f".repeat(64), members: [one, two] });

describe("unwired whitelist member consistency policy", () => {
  it.each(["bad;stop", "Name\nstop", "../world", "ab", "x".repeat(17), " User", "玩家名字"]) ("rejects unsafe name %s before any dispatch", (name) => {
    expect(() => parseWhitelistMemberIntent({ ...add(), name })).toThrowError(/请求格式/);
  });
  it.each([{ path: "private" }, { uuid: two.uuid }, { command: "stop" }, { targetPort: 25575 }, { confirm: false }, { revision: "unknown" }, { action: "reload" }])(
    "rejects extra fields, unsupported actions and unconfirmed requests", (change) => {
      expect(() => parseWhitelistMemberIntent({ ...add(), ...change })).toThrow();
    });
  it("binds root/config/file bytes/file identity and runtime generation into the revision", () => {
    const revision = whitelistMemberRevision(before);
    for (const key of ["rootIdentity", "configRevision", "fileIdentity", "fileSha256"] as const) {
      expect(whitelistMemberRevision({ ...before, [key]: "0".repeat(64) })).not.toBe(revision);
    }
    expect(whitelistMemberRevision({ ...before, runtimeId: "123e4567-e89b-42d3-a456-426614174011" })).not.toBe(revision);
    expect(whitelistMemberRevision({ ...before, serverId: "other" })).not.toBe(revision);
    expect(() => validateWhitelistMemberIntent({ ...add(), revision: "0".repeat(64) }, before)).toThrow();
  });
  it("refuses adding existing or removing absent members and preserves canonical stored name", () => {
    expect(() => validateWhitelistMemberIntent({ ...add(), name: "player_one" }, before)).toThrow();
    expect(() => validateWhitelistMemberIntent({ ...add(), action: "remove" }, before)).toThrow();
    expect(validateWhitelistMemberIntent({ ...add(), action: "remove", name: "player_one" }, before).name).toBe(one.name);
  });
  it("recognizes only an exact one-member addition plus an independently supplied matching runtime list", () => {
    expect(compareWhitelistMemberEvidence(add(), before, after(), [two.name, one.name])).toBe("consistent-change");
    expect(compareWhitelistMemberEvidence(add(), before, after(), [one.name])).toBe("insufficient-evidence");
    expect(compareWhitelistMemberEvidence(add(), before, after(), [one.name, one.name])).toBe("insufficient-evidence");
    expect(compareWhitelistMemberEvidence(add(), before, before, [one.name])).toBe("insufficient-evidence");
  });
  it("recognizes exact removal while preserving every other member identity", () => {
    const baseline = after(), request: WhitelistMemberIntent = { action: "remove", name: "player_two", confirm: true, revision: whitelistMemberRevision(baseline) };
    const removed = { ...baseline, fileSha256: "0".repeat(64), members: [one] };
    expect(compareWhitelistMemberEvidence(request, baseline, removed, [one.name])).toBe("consistent-change");
    expect(compareWhitelistMemberEvidence(request, baseline, { ...removed, members: [{ ...one, uuid: two.uuid }] }, [one.name])).toBe("insufficient-evidence");
  });
  it.each(["serverId", "rootIdentity", "configRevision", "runtimeId"] as const)("rejects changed %s instead of inferring success", (key) => {
    expect(compareWhitelistMemberEvidence(add(), before, { ...after(), [key]: key === "runtimeId" ? two.uuid : key === "serverId" ? "other" : "0".repeat(64) }, [one.name, two.name])).toBe("insufficient-evidence");
  });
  it("rejects unrelated edits, name drift and reused UUIDs", () => {
    for (const member of [{ ...one, name: "ChangedName" }, { ...one, uuid: "123e4567-e89b-42d3-a456-426614174002" }, { ...two }]) {
      expect(compareWhitelistMemberEvidence(add(), before, { ...after(), members: [member, two] }, [member.name, two.name])).toBe("insufficient-evidence");
    }
  });
  it("rejects invalid or oversized observations, including sparse arrays, without filtering", () => {
    const invalid: WhitelistMemberSnapshot = { ...before, members: new Array(1) as typeof before.members };
    expect(() => whitelistMemberRevision(invalid)).toThrow();
    expect(() => whitelistMemberRevision({ ...before, members: Array.from({ length: 1001 }, () => one) })).toThrow();
    expect(compareWhitelistMemberEvidence(add(), before, after(), new Array(2) as string[])).toBe("insufficient-evidence");
  });
  it("rejects unchanging byte evidence even if synthetic parsed membership differs", () => {
    expect(compareWhitelistMemberEvidence(add(), before, { ...after(), fileSha256: before.fileSha256 }, [one.name, two.name])).toBe("insufficient-evidence");
  });
  it("rejects a new add at capacity without truncating stored members", () => {
    const full: WhitelistMemberSnapshot = { ...before, members: Array.from({ length: 1000 }, (_, index) => ({ name: `User_${index}`,
      uuid: `123e4567-e89b-42d3-a456-${index.toString(16).padStart(12, "0")}` })) };
    expect(() => validateWhitelistMemberIntent({ ...add(), revision: whitelistMemberRevision(full) }, full)).toThrowError(/上限/);
  });
  it("is deterministic and leaves caller-owned snapshots unchanged", () => {
    const source = structuredClone(before), next = after(), copy = structuredClone(next);
    expect(whitelistMemberRevision(source)).toBe(whitelistMemberRevision(before));
    expect(compareWhitelistMemberEvidence(add(), source, next, [one.name, two.name])).toBe("consistent-change");
    expect(source).toEqual(before); expect(next).toEqual(copy);
  });
});
