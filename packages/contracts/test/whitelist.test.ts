import { Value } from '@sinclair/typebox/value';
import { expect, it } from 'vitest';
import { whitelistResponseSchema, whitelistMemberRequestSchema, whitelistMutationResponseSchema, whitelistCandidatesResponseSchema } from '../src/index.js';
const payload = { data: { availability: 'available', reason: null, configuredEnabled: false, configuredEnforced: null, effectiveEnabled: null,
  items: [{ name: 'Player_One', uuid: '123e4567-e89b-42d3-a456-426614174000' }], source: 'whitelist-json',
  sampledAt: '2026-10-14T00:00:00Z', membershipWritable: false, writeReason: 'MEMBER_RULE_UNAVAILABLE' },
  meta: { requestId: 'test', generatedAt: '2026-10-14T00:00:00Z', mode: 'local' } };
it('does not permit live-effect or membership-write claims and rejects unknown fields', () => {
  expect(Value.Check(whitelistResponseSchema, payload)).toBe(true);
  for (const extra of [{ effectiveEnabled: true }, { membershipWritable: true }, { root: 'private-path' }])
    expect(Value.Check(whitelistResponseSchema, { ...payload, data: { ...payload.data, ...extra } })).toBe(false);
});
it('separates direct success/failure/unknown results and refuses file paths or arbitrary outcomes', () => {
  const data = { serverId: 'test', action: 'add', name: 'Player_Two', outcome: 'unknown', code: 'WHITELIST_RESULT_UNKNOWN',
    message: 'Unknown; no retry', relatedErrorObserved: null };
  for (const outcome of ['succeeded', 'failed', 'unknown']) expect(Value.Check(whitelistMutationResponseSchema, { data: { ...data, outcome }, meta: payload.meta })).toBe(true);
  expect(Value.Check(whitelistMutationResponseSchema, { data: { ...data, path: 'private-path' }, meta: payload.meta })).toBe(false);
  expect(Value.Check(whitelistMutationResponseSchema, { data: { ...data, outcome: 'executed' }, meta: payload.meta })).toBe(false);
});
it('marks historical candidates unverified and does not permit auto-approval or private source paths', () => {
  const candidate = { name: 'Player_Two', uuid: '123e4567-e89b-42d3-a456-426614174001', source: 'usercache', identityVerified: false };
  const data = { availability: 'available', reason: null, sampledAt: payload.meta.generatedAt, items: [candidate] };
  expect(Value.Check(whitelistCandidatesResponseSchema, { data, meta: payload.meta })).toBe(true);
  for (const change of [{ identityVerified: true }, { path: 'private-path' }, { name: 'bad;stop' }])
    expect(Value.Check(whitelistCandidatesResponseSchema, { data: { ...data, items: [{ ...candidate, ...change }] }, meta: payload.meta })).toBe(false);
});
it('requires a complete revision-bound write capability and a strict single-name request', () => {
  const data = { ...payload.data, membershipWritable: true, writeReason: null, revision: 'a'.repeat(64) };
  expect(Value.Check(whitelistResponseSchema, { ...payload, data })).toBe(true);
  expect(Value.Check(whitelistResponseSchema, { ...payload, data: { ...data, revision: 'bad' } })).toBe(false);
  const body = { action: 'add', name: 'Player_Two', revision: 'a'.repeat(64), confirm: true };
  expect(Value.Check(whitelistMemberRequestSchema, body)).toBe(true);
  for (const change of [{ name: 'bad;stop' }, { uuid: 'unknown' }, { command: 'stop' }, { confirm: false }, { action: 'batch' }])
    expect(Value.Check(whitelistMemberRequestSchema, { ...body, ...change })).toBe(false);
});
