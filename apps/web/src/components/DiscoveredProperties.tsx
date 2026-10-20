import { useState } from 'react';
import type { ConfigurationDiscovery } from '@mcsm/contracts';
import type { PropertiesFieldsProps } from './PropertiesFields';

const options: Record<string, readonly string[]> = {
  difficulty: ['peaceful', 'easy', 'normal', 'hard'], gamemode: ['survival', 'creative', 'adventure', 'spectator'],
};
export function DiscoveredProperties({ discovery, values, currentValues, disabled, onChange }: PropertiesFieldsProps & { discovery: ConfigurationDiscovery }) {
  const [search, setSearch] = useState('');
  const [file, setFile] = useState('all');
  const items = discovery.items.filter(item => (file === 'all' || item.fileId === file) &&
    `${item.key} ${item.label}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const groups = ['基础设置','游戏玩法','世界配置','性能配置','管理与连接','自动发现的已知配置','新发现的未知配置'];
  return <div className="page-stack">
    <p>{discovery.serverType} · Minecraft {discovery.minecraftVersion} · server.properties</p>
    <label>搜索配置<input className="button button--secondary" value={search} onChange={e => setSearch(e.target.value)} /></label>
    <label>配置文件<select className="button button--secondary" value={file} onChange={e => setFile(e.target.value)}>
      <option value="all">全部文件</option>{discovery.files.map(f => <option key={f.id} value={f.id}>{f.source}</option>)}
    </select></label>
    {discovery.omittedCount ? <p role="status">{discovery.omittedCount} 项因敏感内容或安全展示上限未显示；文件内容不会因此删除。</p> : null}
    {groups.map(group => {
      const fields = items.filter(item => (item.category === 'core' ? item.group : item.category === 'known' ? '自动发现的已知配置' : '新发现的未知配置') === group);
      return fields.length ? <section key={group} aria-label={group}><h2>{group}</h2><div className="settings-panel properties-fields">
        {fields.map(item => {
          const id = `discovered-${item.key}`;
          const value = values[item.key] ?? item.rawValue;
          const choices = options[item.key] ?? (['pvp','online-mode'].includes(item.key) ? ['true','false'] : undefined);
          return <div key={item.key} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <label htmlFor={id}>{item.label}</label><code>{item.key}</code>
            {item.editable ? choices ? <select id={id} className="button button--secondary" disabled={disabled} value={value} onChange={e => onChange(item.key,e.target.value)}>
              {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
            </select> : <input id={id} className="button button--secondary" disabled={disabled} type={item.key === 'max-players' ? 'number' : 'text'}
              value={value} onChange={e => onChange(item.key,e.target.value)} /> : <output id={id}>{item.rawValue || '空值'} · 只读：{item.reason}</output>}
            <p>当前值：{currentValues?.[item.key] ?? item.rawValue}{value !== (currentValues?.[item.key] ?? item.rawValue) ? ` · 待修改值：${value}` : ''}</p>
            <p>{item.description} 来源：{item.source} · {item.ruleStatus === 'verified' ? '版本规则已验证' : '仅观察/类型推断'} · {item.restartRequired === null ? '重启要求未知' : item.restartRequired ? '需要重启' : '无需重启'}</p>
          </div>;
        })}</div></section> : null;
    })}
    {!items.length ? <p>没有匹配的安全配置字段。</p> : null}
  </div>;
}
