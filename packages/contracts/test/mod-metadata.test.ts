import { Value } from '@sinclair/typebox/value';
import { FormatRegistry } from '@sinclair/typebox';
import { expect, it } from 'vitest';
import { declaredModMetadataSchema, addonUploadResponseSchema, addonTrashResponseSchema } from '../src/index.js';

const declaration = { loader: 'neoforge', source: 'META-INF/neoforge.mods.toml', modLoader: 'javafml', loaderVersion: null,
  mods: [{ id: 'sample_mod', name: '示例', version: '${file.jarVersion}', versionStatus: 'unresolved', dependencies: [] }] };
it('bounds declarations and keeps trash loaders unchanged', () => {
  expect(Value.Check(declaredModMetadataSchema, declaration)).toBe(true);
  expect(Value.Check(declaredModMetadataSchema, { ...declaration, compatibility: 'compatible' })).toBe(false);
  expect(Value.Check(declaredModMetadataSchema, { ...declaration, root: 'C:/private' })).toBe(false);
  expect(Value.Check(declaredModMetadataSchema, { ...declaration, mods: Array(33).fill(declaration.mods[0]) })).toBe(false);
  expect(Value.Check(addonTrashResponseSchema.properties.data.properties.items.items.properties.loader, 'forge')).toBe(false);
});

it('requires the full matching declaration and unknown compatibility for inert new-loader staging', () => {
  const previous = FormatRegistry.Get('uuid');
  FormatRegistry.Set('uuid', value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value));
  try {
  const data = { id: '90ebcd90-a68e-4e36-9013-33325b9d9007', kind: 'mod', filename: 'sample.jar', sizeBytes: 1024,
    checksumSha256: 'a'.repeat(64), revision: 'b'.repeat(64), name: null, version: null, loader: 'neoforge',
    minecraftConstraint: null, compatibility: 'unknown', declaredMetadata: declaration, state: 'validated', executionAvailable: false };
  expect(Value.Check(addonUploadResponseSchema.properties.data, data)).toBe(true);
  for (const changed of [{ ...data, declaredMetadata: undefined }, { ...data, executionAvailable: true },
    { ...data, loader: 'forge' }, { ...data, compatibility: 'compatible' }, { ...data, kind: 'plugin' },
    { ...data, declaredMetadata: { ...declaration, source: 'META-INF/mods.toml' } }]) {
    expect(Value.Check(addonUploadResponseSchema.properties.data, changed)).toBe(false);
  }
  } finally { if (previous) FormatRegistry.Set('uuid', previous); else FormatRegistry.Delete('uuid'); }
});
