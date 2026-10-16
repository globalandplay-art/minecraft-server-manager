import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import { propertiesResponseSchema, propertiesWriteRequestSchema } from "../src/index.js";
const keys = ['max-players', 'difficulty', 'gamemode', 'pvp', 'online-mode', 'view-distance', 'simulation-distance', 'motd'];
const response = { data: { fields: Object.fromEntries(keys.map(key => [key, null])), revision: 'a'.repeat(64),
  fieldRules: Object.fromEntries(keys.map(key => [key, { editable: false, restartRequired: true, reason: 'VERSION_RULE_UNAVAILABLE' }])) },
  meta: { requestId: 'test', generatedAt: '2026-10-14T00:00:00Z', mode: 'local' } };
it('preserves legacy responses and only accepts nullable observed whitelist booleans with readonly rules', () => {
  expect(Value.Check(propertiesResponseSchema, response)).toBe(true);
  const next = { ...response, data: { ...response.data, fields: { ...response.data.fields, 'white-list': false },
    fieldRules: { ...response.data.fieldRules, 'white-list': { editable: false, restartRequired: true, reason: 'VERSION_RULE_UNAVAILABLE' } } } };
  expect(Value.Check(propertiesResponseSchema, next)).toBe(true);
  expect(Value.Check(propertiesResponseSchema, { ...next, data: { ...next.data, fields: { ...next.data.fields, 'white-list': 'false' } } })).toBe(false);
  expect(Value.Check(propertiesResponseSchema, { ...next, data: { ...next.data, fieldRules: { ...next.data.fieldRules,
    'white-list': { editable: true, restartRequired: true, reason: null } } } })).toBe(false);
});
it.each(['white-list', 'enforce-whitelist'])('rejects readonly %s in standalone or mixed write contracts', key => {
  for (const changes of [{ [key]: 'true' }, { pvp: 'false', [key]: 'true' }])
    expect(Value.Check(propertiesWriteRequestSchema, { changes, confirmOfflineIdentity: false })).toBe(false);
});
