import type { ChangeEvent } from 'react';

export type PropertiesFieldKey =
  | 'max-players'
  | 'difficulty'
  | 'gamemode'
  | 'pvp'
  | 'online-mode'
  | 'view-distance'
  | 'simulation-distance'
  | 'motd';

export type PropertiesFieldsProps = {
  values: Record<string, string>;
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
  { key: 'view-distance', label: '视距', kind: 'text' },
  { key: 'simulation-distance', label: '模拟距离', kind: 'text' },
  { key: 'motd', label: '服务器描述', kind: 'text' },
];

const optionLabels: Record<string, string> = {
  peaceful: '和平', easy: '简单', normal: '普通', hard: '困难',
  survival: '生存', creative: '创造', adventure: '冒险', spectator: '旁观',
  true: '启用', false: '关闭',
};

export function PropertiesFields({ values, rules, disabled, onChange }: PropertiesFieldsProps) {
  return (
    <div className="page-stack" style={{ width: '100%', maxWidth: '100%' }}>
      <p>标记为需要重启的修改将在重启后生效。</p>
      <section className="settings-panel properties-fields" aria-label="服务器属性">
        {fields.map(({ key, label, kind, options }) => {
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
                type="text" inputMode={kind === 'numeric' ? 'numeric' : undefined} placeholder="未提供"
                value={value} disabled={disabled} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(key, event.target.value)} />
            )
          ) : (
            <span id={id} aria-labelledby={`${id}-label`}>{value || '未提供'} · 只读：版本规则未确认</span>
          );

          return <div key={key}>
            {editable ? <label htmlFor={id}>{label}</label> : <span id={`${id}-label`}>{label}</span>}
            <div>{control}{restartNote ? <p>{restartNote}</p> : null}</div>
          </div>;
        })}
      </section>
    </div>
  );
}
