import type { ChangeEvent } from 'react';

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
  values: Record<string, string>;
  currentValues?: Record<string, string>;
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

const optionLabels: Record<string, string> = {
  peaceful: '和平', easy: '简单', normal: '普通', hard: '困难',
  survival: '生存', creative: '创造', adventure: '冒险', spectator: '旁观',
  true: '启用', false: '关闭',
};

const groups = [
  { name: '游戏玩法', keys: ['difficulty', 'gamemode', 'pvp'] },
  { name: '玩家管理', keys: ['max-players', 'white-list', 'enforce-whitelist', 'online-mode'] },
  { name: '性能', keys: ['view-distance', 'simulation-distance'] },
  { name: '其他设置', keys: ['motd'] },
];
const displayValue = (value: string | undefined, kind: string) => value === undefined || value === '' ? '未提供' : kind === 'select' ? optionLabels[value] ?? value : value;

export function PropertiesFields({ values, currentValues, rules, disabled, onChange }: PropertiesFieldsProps) {
  return (
    <div className="page-stack" style={{ width: '100%', maxWidth: '100%' }}>
      <p>标记为需要重启的修改将在重启后生效。</p>
      {groups.map(group => <section key={group.name} aria-label={group.name}>
        <h2>{group.name}</h2>
        <div className="settings-panel properties-fields">
        {fields.filter(field => group.keys.includes(field.key)).map(({ key, label, kind, options }) => {
          const id = `property-${key}`;
          const value = values[key] ?? '';
          const rule = rules[key];
          const editable = rule?.editable === true;
          const restartNote = rule?.restartRequired ? '修改需要重启后生效' : null;
          const control = editable ? (
            kind === 'select' ? (
              <select id={id} className="button button--secondary" style={{ width: '100%', maxWidth: '100%' }}
                value={value} disabled={disabled} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(key, event.target.value)}>
                <option value="">未提供</option>
                {options?.map((option) => <option key={option} value={option}>{optionLabels[option]}</option>)}
                {value && !options?.includes(value) ? <option value={value}>{value}</option> : null}
              </select>
            ) : (
              <input id={id} className="button button--secondary" style={{ width: '100%', maxWidth: '100%' }}
                type={kind === 'numeric' ? 'number' : 'text'} inputMode={kind === 'numeric' ? 'numeric' : undefined}
                min={key === 'max-players' ? 1 : undefined} max={key === 'max-players' ? 10000 : undefined} step={kind === 'numeric' ? 1 : undefined} placeholder="未提供"
                value={value} disabled={disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(key, event.target.value)} />
            )
          ) : (
            <span id={id} aria-labelledby={`${id}-label`}>{displayValue(value, kind)} · 只读：版本规则未确认</span>
          );

          return <div key={key}>
            {editable ? <label htmlFor={id}>{label}</label> : <span id={`${id}-label`}>{label}</span>}
            <div>{control}{restartNote ? <p>{restartNote}</p> : editable ? <p>无需重启；本页不发送在线命令</p> : null}
              {currentValues ? <p>当前值：{displayValue(currentValues[key], kind)}{value !== (currentValues[key] ?? '') ? ` · 待修改值：${displayValue(value, kind)}` : ''}</p> : null}
            </div>
          </div>;
        })}
        </div>
      </section>)}
    </div>
  );
}
