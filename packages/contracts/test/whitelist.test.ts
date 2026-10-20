import { Value } from '@sinclair/typebox/value';
import { expect, it } from 'vitest';
import { whitelistResponseSchema, whitelistMemberRequestSchema } from '../src/index.js';
const payload = { data: { availability: 'available', reason: null, configuredEnabled: false, configuredEnforced: null, effectiveEnabled: null,
  items: [{ name: 'Player_One', uuid: '123e4567-e89b-42d3-a456-426614174000' }], source: 'whitelist-json',
  sampledAt: '2026-10-14T00:00:00Z', membershipWritable: false, writeReason: 'MEMBER_RULE_UNAVAILABLE' },
  meta: { requestId: 'test', generatedAt: '2026-10-14T00:00:00Z', mode: 'local' } };
it('does not permit live-effect or membership-write claims and rejects unknown fields', () => {
  expect(Value.Check(whitelistResponseSchema, payload)).toBe(true);
  for (const extra of [{ effectiveEnabled: true }, { membershipWritable: true }, { root: 'private-path' }])
    expect(Value.Check(whitelistResponseSchema, { ...payload, data: { ...payload.data, ...extra } })).toBe(false);
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
