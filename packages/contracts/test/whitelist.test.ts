import { Value } from '@sinclair/typebox/value';
import { expect, it } from 'vitest';
import { whitelistResponseSchema } from '../src/index.js';
const payload = { data: { availability: 'available', reason: null, configuredEnabled: false, configuredEnforced: null, effectiveEnabled: null,
  items: [{ name: 'Player_One', uuid: '123e4567-e89b-42d3-a456-426614174000' }], source: 'whitelist-json',
  sampledAt: '2026-10-14T00:00:00Z', membershipWritable: false, writeReason: 'MEMBER_RULE_UNAVAILABLE' },
  meta: { requestId: 'test', generatedAt: '2026-10-14T00:00:00Z', mode: 'local' } };
it('does not permit live-effect or membership-write claims and rejects unknown fields', () => {
  expect(Value.Check(whitelistResponseSchema, payload)).toBe(true);
  for (const extra of [{ effectiveEnabled: true }, { membershipWritable: true }, { root: 'private-path' }])
    expect(Value.Check(whitelistResponseSchema, { ...payload, data: { ...payload.data, ...extra } })).toBe(false);
});
