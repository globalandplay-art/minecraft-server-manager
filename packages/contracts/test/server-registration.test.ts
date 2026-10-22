import { expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { registrationDraftSchema, registrationRemoveResponseSchema } from '../src/index.js';
const draft = { id: 'second', name: 'Second', root: 'C:\\MC\\second', jarFile: 'server.jar', javaProfileId: 'first' };
it('accepts a scoped registration draft', () => { expect(Value.Check(registrationDraftSchema, draft)).toBe(true); });
it.each(['javaExecutable', 'jvmArgs', 'serverArgs', 'password'])('rejects browser-provided %s', field => {
  expect(Value.Check(registrationDraftSchema, { ...draft, [field]: 'injected' })).toBe(false);
});
it('accepts truthful remove-only results and rejects a file-deletion claim', () => {
  const result = { data: { id: 'second', removed: true, filesPreserved: true, unloaded: true, restartRequired: false, unloadErrorCode: null },
    meta: { requestId: 'test', generatedAt: new Date().toISOString(), mode: 'local' } };
  expect(Value.Check(registrationRemoveResponseSchema, result)).toBe(true);
  expect(Value.Check(registrationRemoveResponseSchema, { ...result, data: { ...result.data, filesPreserved: false } })).toBe(false);
  expect(Value.Check(registrationRemoveResponseSchema, { ...result, data: { ...result.data, root: 'C:\\private' } })).toBe(false);
});
