import { expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { registrationDraftSchema } from '../src/index.js';
const draft = { id: 'second', name: 'Second', root: 'C:\\MC\\second', jarFile: 'server.jar', javaProfileId: 'first' };
it('accepts a scoped registration draft', () => { expect(Value.Check(registrationDraftSchema, draft)).toBe(true); });
it.each(['javaExecutable', 'jvmArgs', 'serverArgs', 'password'])('rejects browser-provided %s', field => {
  expect(Value.Check(registrationDraftSchema, { ...draft, [field]: 'injected' })).toBe(false);
});
