import type { ConfigurationDiscovery } from '@mcsm/contracts';
import { DiscoveredProperties } from './DiscoveredProperties';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '../i18n';
import { propertyGroup, propertyLabel, propertyOption } from '../i18n/properties';

export type PropertiesFieldKey =
  | 'max-players'
  | 'difficulty'
  | 'gamemode'
  | 'pvp'
  | 'online-mode'
  | 'view-distance'
  | 'simulation-distance'
  | 'motd'
  | 'white-list'
  | 'enforce-whitelist';

export type PropertiesFieldsProps = {
  discovery?: ConfigurationDiscovery | undefined;
  values: Record<string, string>;
  currentValues?: Record<string, string> | undefined;
  rules: Record<string, { editable: boolean; restartRequired: boolean; reason: string | null }>;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
};

const fields: { key: PropertiesFieldKey; label: string; kind: 'text' | 'numeric' | 'select'; options?: readonly string[] }[] = [
  { key: 'max-players', label: '最大玩家数', kind: 'numeric' },
  { key: 'difficulty', label: '难度', kind: 'select', options: ['peaceful', 'easy', 'normal', 'hard'] },
  { key: 'gamemode', label: '游戏模式', kind: 'select', options: ['survival', 'creative', 'adventure', 'spectator'] },
  { key: 'pvp', label: '玩家对战', kind: 'select', options: ['true', 'false'] },
  { key: 'online-mode', label: '正版验证', kind: 'select', options: ['true', 'false'] },
  { key: 'white-list', label: '启用白名单', kind: 'select', options: ['true', 'false'] },
  { key: 'enforce-whitelist', label: '强制执行白名单', kind: 'select', options: ['true', 'false'] },
  { key: 'view-distance', label: '视距', kind: 'numeric' },
  { key: 'simulation-distance', label: '模拟距离', kind: 'numeric' },
  { key: 'motd', label: '服务器描述', kind: 'text' },
];

const groups = [
  { name: '游戏玩法', keys: ['difficulty', 'gamemode', 'pvp'] },
  { name: '玩家管理', keys: ['max-players', 'white-list', 'enforce-whitelist', 'online-mode'] },
  { name: '性能', keys: ['view-distance', 'simulation-distance'] },
  { name: '其他设置', keys: ['motd'] },
];
const displayValue = (value: string | undefined, kind: string) => value === undefined || value === '' ? i18n.t('property.unprovided') : kind === 'select' ? propertyOption(value) : value;

export function PropertiesFields({ discovery, values, currentValues, rules, disabled, onChange }: PropertiesFieldsProps) {
  const { t } = useTranslation();
  if (discovery) return <DiscoveredProperties discovery={discovery} values={values} currentValues={currentValues} rules={rules} disabled={disabled} onChange={onChange} />;
  return (
    <div className="page-stack" style={{ width: '100%', maxWidth: '100%' }}>
      <p>{t('property.restartNotice')}</p>
      {groups.map(group => <section key={group.name} aria-label={propertyGroup(group.name)}>
        <h2>{propertyGroup(group.name)}</h2>
        <div className="settings-panel properties-fields">
        {fields.filter(field => group.keys.includes(field.key)).map(({ key, label, kind, options }) => {
          const id = `property-${key}`;
          const value = values[key] ?? '';
          const rule = rules[key];
          const editable = rule?.editable === true;
          const restartNote = rule?.restartRequired ? t('property.restart') : null;
          const control = editable ? (
            kind === 'select' ? (
              <select id={id} className="button button--secondary" style={{ width: '100%', maxWidth: '100%' }}
                value={value} disabled={disabled} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(key, event.target.value)}>
                <option value="">{t('property.unprovided')}</option>
                {options?.map((option) => <option key={option} value={option}>{propertyOption(option)}</option>)}
                {value && !options?.includes(value) ? <option value={value}>{value}</option> : null}
              </select>
            ) : (
              <input id={id} className="button button--secondary" style={{ width: '100%', maxWidth: '100%' }}
                type={kind === 'numeric' ? 'number' : 'text'} inputMode={kind === 'numeric' ? 'numeric' : undefined}
                min={key === 'max-players' ? 1 : undefined} max={key === 'max-players' ? 10000 : undefined} step={kind === 'numeric' ? 1 : undefined} placeholder={t('property.unprovided')}
                value={value} disabled={disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(key, event.target.value)} />
            )
          ) : (
            <span id={id} aria-labelledby={`${id}-label`}>{displayValue(value, kind)} · {t('property.readOnlyReason', { reason: t('property.unknownRule') })}</span>
          );

          return <div key={key}>
            {editable ? <label htmlFor={id}>{propertyLabel(key, label)}</label> : <span id={`${id}-label`}>{propertyLabel(key, label)}</span>}
            <div>{control}{restartNote ? <p>{restartNote}</p> : editable ? <p>{t('property.noRestart')}</p> : null}
              {currentValues ? <p>{t('property.current', { value: displayValue(currentValues[key], kind) })}{value !== (currentValues[key] ?? '') ? ` · ${t('property.draft', { value: displayValue(value, kind) })}` : ''}</p> : null}
            </div>
          </div>;
        })}
        </div>
      </section>)}
    </div>
  );
}
