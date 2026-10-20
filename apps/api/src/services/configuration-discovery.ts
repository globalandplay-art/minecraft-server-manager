import { sensitivePropertyKey, privatePropertyValue } from './properties-sensitive.js';
import { createRedactor } from '../infra/runtime/redactor.js';
import { editablePropertyEntries } from './properties-grammar.js';

// Descriptions are a catalogue, not evidence that a property exists in a version.
const core = [
  ['motd','服务器描述','基础设置'], ['server-ip','监听地址','基础设置'], ['server-port','游戏端口','基础设置'],
  ['max-players','最大玩家数','基础设置'], ['online-mode','正版验证','基础设置'], ['white-list','启用白名单','基础设置'], ['enforce-whitelist','强制执行白名单','基础设置'],
  ['gamemode','游戏模式','游戏玩法'], ['difficulty','难度','游戏玩法'], ['hardcore','极限模式','游戏玩法'], ['force-gamemode','强制游戏模式','游戏玩法'], ['pvp','玩家对战','游戏玩法'],
  ['level-name','世界名称','世界配置'], ['level-seed','世界种子','世界配置'], ['generate-structures','生成结构','世界配置'], ['spawn-protection','出生点保护','世界配置'],
  ['view-distance','视距','性能配置'], ['simulation-distance','模拟距离','性能配置'], ['max-tick-time','最大刻时间','性能配置'],
  ['enable-rcon','启用 RCON','管理与连接'], ['enable-query','启用 Query','管理与连接'], ['management-server-enabled','启用管理服务','管理与连接'],
] as const;
const verified = new Set(['motd','max-players','difficulty','gamemode','pvp','online-mode']);
const known = new Set(['allow-flight','enable-command-block','player-idle-timeout','network-compression-threshold']);
const sensitive = new Set(['server-ip','server-port','online-mode','enable-rcon','enable-query','management-server-enabled']);
export type DiscoveryRule = { editable: boolean; restartRequired: boolean; reason: string | null };

/** Bounded public projection from an already identity-checked snapshot. Never exposes bytes/paths/secrets. */
export function discoverConfiguration(text: string, type: string, version: string,
  rules: Record<string, DiscoveryRule>, safeValues: Record<string, string | number | boolean | null>) {
  const entries = editablePropertyEntries(text);
  const values = new Map(entries);
  const counts = new Map<string, number>();
  for (const [key] of entries) counts.set(key, (counts.get(key) ?? 0) + 1);
  const redactor = createRedactor({ secrets: () => entries.filter(([key]) => sensitivePropertyKey(key)).map(([, value]) => value) });
  const items = [];
  let omittedCount = 0;
  for (const [key, value] of values) {
    if (items.length >= 512 || key.length > 128 || !/^[A-Za-z0-9_.-]+$/u.test(key) || sensitivePropertyKey(key) ||
      redactor.redactText(key) !== key || value.length > 1024 || privatePropertyValue(value) || /[\u0000-\u001f\u007f]/u.test(value) || redactor.redactText(value) !== value) {
      omittedCount++; continue;
    }
    const catalogue = core.find(([name]) => name === key);
    const duplicate = counts.get(key)! > 1;
    const validated = type === 'vanilla' && version === '26.3' && verified.has(key);
    const editable = validated && !duplicate && rules[key]?.editable === true && safeValues[key] !== null && safeValues[key] !== undefined;
    const inferred = value === 'true' || value === 'false' ? 'boolean' : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value) && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER ? 'number' : 'string';
    items.push({ key, label: catalogue?.[1] ?? key, group: catalogue?.[2] ?? '自动发现配置',
      category: catalogue ? 'core' : known.has(key) ? 'known' : 'unknown', rawValue: value,
      value: inferred === 'boolean' ? value === 'true' : inferred === 'number' ? Number(value) : value,
      inferredType: inferred, source: 'server.properties', fileId: 'server-properties',
      ruleStatus: validated ? 'verified' : 'unverified', editable, sensitive: sensitive.has(key), duplicate,
      restartRequired: validated ? true : null,
      reason: editable ? null : duplicate ? 'DUPLICATE_KEY' : 'VERSION_RULE_UNAVAILABLE',
      description: validated ? '复用已验证的 Vanilla 26.3 配置规则；保存后需显式重启。' : '从实际文件发现；类型仅供展示，尚无已验证写入规则。',
    });
  }
  return { files: [{ id: 'server-properties', source: 'server.properties', format: 'properties', editable: type === 'vanilla' && version === '26.3' }],
    serverType: type, minecraftVersion: version, items, omittedCount };
}
