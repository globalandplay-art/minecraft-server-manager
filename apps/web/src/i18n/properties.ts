import { i18n } from './index';
import { resources } from './resources';

export function propertyLabel(key: string, fallback: string): string {
  return i18n.exists(`property.${key}`) ? i18n.t(`property.${key}`) : fallback;
}
export function propertyOption(value: string): string {
  return i18n.exists(`property.option.${value}`) ? i18n.t(`property.option.${value}`) : value;
}
const groups: Record<string, string> = {
  基础设置: 'basic', 游戏玩法: 'gameplay', 玩家管理: 'players', 世界配置: 'world',
  性能配置: 'performance', 性能: 'performanceLegacy', 管理与连接: 'connections',
  其他设置: 'other', 自动发现的已知配置: 'known', 新发现的未知配置: 'unknown',
};
export function propertyGroup(group: string): string {
  return groups[group] ? i18n.t(`property.group.${groups[group]}`) : group;
}
export function propertyDescription(description: string): string {
  const key = (['property.description.verified', 'property.description.observed'] as const)
    .find(key => resources['zh-CN'].translation[key] === description);
  return key ? i18n.t(key) : description;
}
export function propertyReason(reason: string | null): string {
  const key = reason === 'VERSION_RULE_UNAVAILABLE' ? 'property.unknownRule' : reason === 'DUPLICATE_KEY' ? 'property.duplicate' : undefined;
  return key ? `${i18n.t(key)} (${reason})` : reason ?? '';
}
