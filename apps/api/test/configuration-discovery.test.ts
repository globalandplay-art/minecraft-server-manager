import { describe, expect, it } from 'vitest';
import { discoverConfiguration } from '../src/services/configuration-discovery.js';
const rules = { pvp: { editable: true, restartRequired: true, reason: null } };
const discover = (text: string, type = 'vanilla', version = '26.3') => discoverConfiguration(text,type,version,rules,{ pvp: true });
describe('bounded configuration discovery', () => {
  it('discovers new fields without core duplication and does not grant inferred writes', () => {
    const result = discover('pvp=true\nnew-performance-option=12\nnew-flag=false\nambiguous=001\n');
    expect(result.items.filter(item => item.key === 'pvp')).toHaveLength(1);
    expect(result.items.find(item => item.key === 'new-performance-option')).toMatchObject({ value: 12, category: 'unknown', editable: false, restartRequired: null });
    expect(result.items.find(item => item.key === 'new-flag')).toMatchObject({ value: false, inferredType: 'boolean', editable: false });
    expect(result.items.find(item => item.key === 'ambiguous')?.inferredType).toBe('string');
  });
  it('only enables exact validated version/type and actual unambiguous targets', () => {
    expect(discover('pvp=true\n').items[0]?.editable).toBe(true);
    for (const [type,version] of [['vanilla','26.4'],['paper','26.3'],['fabric','26.3']]) expect(discover('pvp=true\n',type,version).items[0]?.editable).toBe(false);
    expect(discover('pvp=false\npvp=true\n').items[0]).toMatchObject({ duplicate: true, editable: false, reason: 'DUPLICATE_KEY' });
    expect(discover('new=true\n').items.some(item => item.key === 'pvp')).toBe(false);
  });
  it('projects additions/removals/value changes rather than caching a schema', () => {
    expect(discover('old=1\n').items.map(item => item.key)).toEqual(['old']);
    expect(discover('new=2\n').items.map(item => item.key)).toEqual(['new']);
    expect(discover('new=3\n').items[0]?.value).toBe(3);
  });
  it('preserves Java properties separators, escapes and continuation semantics', () => {
    expect(discover('motd:hello\\u0020world\nnew-value = first\\\n second\n').items.map(item => item.rawValue)).toEqual(['hello world','firstsecond']);
  });
  it('never returns sensitive keys, copied secrets or raw control content', () => {
    const result = discover('rcon.password=PRIVATE_FIXTURE\ncopy=PRIVATE_FIXTURE\nnew-key=ok\ntoken=PRIVATE_TOKEN\n');
    expect(result.items.map(item => item.key)).toEqual(['new-key']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(result.omittedCount).toBe(3);
  });
  it('keeps remote/core switches read-only and bounds output', () => {
    const result = discover('enable-rcon=true\nserver-port=25565\nmanagement-server-enabled=true\n'+Array.from({length: 600},(_,i)=>`new-${i}=1`).join('\n'));
    expect(result.items).toHaveLength(512); expect(result.omittedCount).toBe(91);
    expect(result.items.filter(item => item.category === 'core').every(item => !item.editable)).toBe(true);
  });
  it.each(['api-key','api_key','apikey','private-key','access-key'])('withholds %s and values copied into aliases', key => {
    const result = discover(`${key}=PRIVATE_SENTINEL\nalias=PRIVATE_SENTINEL\nmotd=PRIVATE_SENTINEL\n`);
    expect(result.items).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
  });
  it.each(['https://user:password@example.invalid/','C:\\Users\\Owner\\private.json','/private/file','\\\\host\\share'])('withholds private path or userinfo value', value => {
    expect(discover(`new-field=${value.replaceAll('\\','\\\\')}\n`).items).toEqual([]);
  });
});
