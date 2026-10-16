import { expect, it } from "vitest";
import { WhitelistAclScope } from "../src/services/whitelist-acl-scope.js";
import { AuthCoreError } from "../src/auth/password.js";

// Structural upper bounds from the actual store loops, NOT a disk/native throughput claim.
const GUARD_SCAN_QUERIES = 1 + 1000 * (1 + 64) * 2;
const GUARD_CREATE_UPPER_QUERIES = GUARD_SCAN_QUERIES + 65 * 7;
const sid = "S-1-5-21-1-2-3-1001";
const snapshot = Object.freeze({ userSid: sid, ownerSid: sid, protected: true,
  aces: Object.freeze([Object.freeze({ sid, kind: "allow", flags: 0, mask: 0x1f01ff })]) });
const targets = ["synthetic-namespace", "synthetic-guard", "synthetic-file"];
function fixture() {
  let mutation = false, live = 0, children = 0, queries = 0, closes = 0, maxChildQueries = 0, releases = 0;
  const owner = { assertHeld: () => undefined, rootIdentity: () => "synthetic-capacity-root",
    beginOfflineMutation: () => {
      if (mutation) throw new AuthCoreError("AUTH_BUSY"); mutation = true;
      return () => { if (live) throw new Error("CAPACITY_RELEASE_BEFORE_CLOSE"); mutation = false; releases++; };
    } };
  const scope = new WhitelistAclScope(owner, "synthetic-capacity-root", () => {
    if (live) throw new Error("CAPACITY_OVERLAPPING_CHILDREN"); live++; children++;
    let closed = false, childQueries = 0;
    return { get closedConfirmed() { return closed; }, get healthyForRotation() { return !closed; },
      query: async (files) => {
        if (closed || files.length !== 3 || files.some((file, i) => file !== targets[i])) throw new Error("CAPACITY_QUERY_CHANGED");
        queries++; childQueries++; maxChildQueries = Math.max(maxChildQueries, childQueries); return files.map(() => snapshot);
      },
      close: async () => { if (!closed) { closed = true; live--; closes++; } }
    };
  }, () => 0); // Counting only; independent real-wall50s fence below, no clock/deadline claim.
  return { scope, counts: () => ({ mutation, live, children, queries, closes, maxChildQueries, releases }) };
}
function workFence(started: number) { if (performance.now() - started >= 50_000) throw new Error("CAPACITY_OBSERVATION_DEADLINE"); }

it("processes the conservative maximum guard-create query bound through healthy rotation and real scope validation", async () => {
  const started = performance.now(), f = fixture();
  await f.scope.run(async (acl) => {
    for (let i = 0; i < GUARD_CREATE_UPPER_QUERIES; i++) { workFence(started); await acl.verifyMany(targets); }
  });
  workFence(started);
  expect(f.counts()).toEqual({ mutation: false, live: 0, children: Math.ceil(GUARD_CREATE_UPPER_QUERIES / 32),
    queries: GUARD_CREATE_UPPER_QUERIES, closes: Math.ceil(GUARD_CREATE_UPPER_QUERIES / 32), maxChildQueries: 32, releases: 1 });
}, 60_000);

it("admits the maximum guard-create bound even with one child per query, then refuses excess before any extra start or dispatch", async () => {
  const started = performance.now(), f = fixture();
  await expect(f.scope.run(async (acl) => {
    // Quiescence models the most expensive valid publication pattern, not retries.
    for (let i = 0; i < 131073; i++) {
      workFence(started); await acl.verifyMany(targets); await acl.quiesce();
      if (i + 1 === GUARD_CREATE_UPPER_QUERIES) {
        expect(f.counts()).toMatchObject({ queries: GUARD_CREATE_UPPER_QUERIES, children: GUARD_CREATE_UPPER_QUERIES, live: 0, mutation: true });
      }
    }
  })).rejects.toMatchObject({ code: "WHITELIST_ACL_SCOPE_UNSAFE" });
  workFence(started);
  expect(f.counts()).toEqual({ mutation: false, live: 0, children: 131072, queries: 131072, closes: 131072, maxChildQueries: 1, releases: 1 });
}, 60_000);
