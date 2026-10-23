import { expect, it } from 'vitest';
import { parseForgeAddonMetadata } from '../src/services/forge-addon-metadata.js';

const header = 'modLoader="javafml"\nloaderVersion="[1,)"\n';
const mod = '[[mods]]\nmodId="example_mod"\ndisplayName="示例模组"\nversion="1.2.3"\n';
const bytes = (text: string) => Buffer.from(text);
it.each(['forge', 'neoforge'] as const)('projects %s declarations without evaluating ranges or compatibility', loader => {
  const raw = '\uFEFF' + header + mod + 'description="""multiple\nlines"""\n[[dependencies.example_mod]]\nmodId="minecraft"\nversionRange="[26.3,27)"\nside="SERVER"\n' + (loader === 'forge' ? 'mandatory=true\n' : 'type="required"\n');
  expect(parseForgeAddonMetadata(bytes(raw), loader)).toMatchObject({ loader, modLoader: 'javafml', loaderVersion: '[1,)',
    mods: [{ id: 'example_mod', name: '示例模组', version: '1.2.3', versionStatus: 'declared',
      dependencies: [{ id: 'minecraft', versionRange: '[26.3,27)', side: 'SERVER', requirement: 'required' }] }] });
});
it('preserves multi-mod ownership, unresolved expressions and missing values without inventing defaults', () => {
  const result = parseForgeAddonMetadata(bytes(header + mod.replace('1.2.3', '${file.jarVersion}') + '[[mods]]\nmodId="second_mod"\n[[dependencies.second_mod]]\nmodId="library_mod"\nversionRange=""\ntype="optional"\n'), 'neoforge');
  expect(result?.mods).toMatchObject([{ version: '${file.jarVersion}', versionStatus: 'unresolved', dependencies: [] },
    { id: 'second_mod', name: 'second_mod', version: null, versionStatus: 'unspecified', dependencies: [{ id: 'library_mod', versionRange: '', requirement: 'optional', side: 'unknown' }] }]);
});
it.each(['required', 'optional', 'incompatible', 'discouraged'] as const)('retains NeoForge dependency type %s', type => {
  expect(parseForgeAddonMetadata(bytes(header + mod + `[[dependencies.example_mod]]\nmodId="library"\ntype="${type}"\n`), 'neoforge')?.mods[0]?.dependencies[0]?.requirement).toBe(type);
});
it.each([
  'modLoader="javafml"\nmods=[]', header + mod + 'version="duplicate"\n', header + mod + mod,
  header + mod.replace('example_mod', 'Invalid Name'), header + mod.replace('version="1.2.3"', 'version=12'),
  header + mod.replace('示例模组', '\\u0000'), header + mod + '[[dependencies.orphan]]\nmodId="minecraft"\n',
  header + mod + '[[dependencies.example_mod]]\nmodId="minecraft"\ntype="invented"\n',
  header + mod + '[[dependencies.example_mod]]\nmodId="minecraft"\nside="invented"\n',
  header + mod + '\n[__proto__]\npolluted=true\n', header + mod + '\n[constructor]\npolluted=true\n',
  header + mod + 'unknown=' + '['.repeat(40) + '0' + ']'.repeat(40),
  header + mod + '\n[' + Array(40).fill('deep').join('.') + ']\nvalue=true\n',
  header + Array.from({ length: 33 }, (_, index) => `[[mods]]\nmodId="mod_${index}"\n`).join(''),
  header + mod + Array(65).fill('[[dependencies.example_mod]]\nmodId="library"\n').join(''),
])('rejects malformed, ambiguous or excessive declarations', raw => {
  expect(parseForgeAddonMetadata(bytes(raw), 'neoforge')).toBeNull();
  expect(Object.prototype).not.toHaveProperty('polluted');
});
it('rejects invalid UTF8, oversized input and oversized parsed value counts', () => {
  expect(parseForgeAddonMetadata(Buffer.from([0xc3, 0x28]), 'forge')).toBeNull();
  expect(parseForgeAddonMetadata(Buffer.alloc(256 * 1024 + 1), 'forge')).toBeNull();
  expect(parseForgeAddonMetadata(bytes(header + mod + 'unknown=[' + Array(8193).fill('0').join(',') + ']'), 'forge')).toBeNull();
});
it('does not interpret NeoForge requirement fields using Forge rules', () => {
  const raw = header + mod + '[[dependencies.example_mod]]\nmodId="minecraft"\ntype="required"\n';
  expect(parseForgeAddonMetadata(bytes(raw), 'forge')?.mods[0]?.dependencies[0]?.requirement).toBe('unknown');
  expect(parseForgeAddonMetadata(bytes(raw.replace('type="required"', 'mandatory="true"')), 'forge')).toBeNull();
});
it('does not treat a TOML datetime as a dependency table or inherit Object prototype fields', () => {
  expect(parseForgeAddonMetadata(bytes('dependencies=2026-10-23T12:00:00Z\n' + header + mod), 'neoforge')).toBeNull();
  expect(parseForgeAddonMetadata(bytes(header + '[[mods]]\nmodId="constructor"\n'), 'forge')?.mods[0]?.dependencies).toEqual([]);
});
