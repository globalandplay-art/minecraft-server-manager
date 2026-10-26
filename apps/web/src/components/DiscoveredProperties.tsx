import { useState } from 'react';
import type { ConfigurationDiscovery } from '@mcsm/contracts';
import type { PropertiesFieldsProps } from './PropertiesFields';
import { useTranslation } from 'react-i18next';
import { propertyDescription, propertyGroup, propertyLabel, propertyOption, propertyReason } from '../i18n/properties';

const options: Record<string, readonly string[]> = {
  difficulty: ['peaceful', 'easy', 'normal', 'hard'], gamemode: ['survival', 'creative', 'adventure', 'spectator'],
};
export function DiscoveredProperties({ discovery, values, currentValues, disabled, onChange }: PropertiesFieldsProps & { discovery: ConfigurationDiscovery }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [file, setFile] = useState('all');
  const items = discovery.items.filter(item => (file === 'all' || item.fileId === file) &&
    `${item.key} ${item.label} ${propertyLabel(item.key, item.label)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const groups = ['基础设置','游戏玩法','世界配置','性能配置','管理与连接','自动发现的已知配置','新发现的未知配置'];
  return <div className="page-stack">
    <p>{discovery.serverType} · Minecraft {discovery.minecraftVersion} · server.properties</p>
    <label>{t('property.search')}<input className="button button--secondary" value={search} onChange={e => setSearch(e.target.value)} /></label>
    <label>{t('property.file')}<select className="button button--secondary" value={file} onChange={e => setFile(e.target.value)}>
      <option value="all">{t('property.allFiles')}</option>{discovery.files.map(f => <option key={f.id} value={f.id}>{f.source}</option>)}
    </select></label>
    {discovery.omittedCount ? <p role="status">{t('property.omitted', { count: discovery.omittedCount })}</p> : null}
    {groups.map(group => {
      const fields = items.filter(item => (item.category === 'core' ? item.group : item.category === 'known' ? '自动发现的已知配置' : '新发现的未知配置') === group);
      return fields.length ? <section key={group} aria-label={propertyGroup(group)}><h2>{propertyGroup(group)}</h2><div className="settings-panel properties-fields">
        {fields.map(item => {
          const id = `discovered-${item.key}`;
          const value = values[item.key] ?? item.rawValue;
          const choices = options[item.key] ?? (['pvp','online-mode'].includes(item.key) ? ['true','false'] : undefined);
          return <div key={item.key} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <label htmlFor={id}>{propertyLabel(item.key, item.label)}</label><code>{item.key}</code>
            {item.editable ? choices ? <select id={id} className="button button--secondary" disabled={disabled} value={value} onChange={e => onChange(item.key,e.target.value)}>
              {choices.map(choice => <option key={choice} value={choice}>{propertyOption(choice)}</option>)}
            </select> : <input id={id} className="button button--secondary" disabled={disabled} type={item.key === 'max-players' ? 'number' : 'text'}
              value={value} onChange={e => onChange(item.key,e.target.value)} /> : <output id={id}>{item.rawValue || t('property.empty')} · {t('property.readOnlyReason', { reason: propertyReason(item.reason) })}</output>}
            <p>{t('property.current', { value: currentValues?.[item.key] ?? item.rawValue })}{value !== (currentValues?.[item.key] ?? item.rawValue) ? ` · ${t('property.draft', { value })}` : ''}</p>
            <p>{propertyDescription(item.description)} {t('property.source', { source: item.source })} · {t(item.ruleStatus === 'verified' ? 'property.verified' : 'property.inferred')} · {t(item.restartRequired === null ? 'property.restartUnknown' : item.restartRequired ? 'property.restartRequired' : 'property.restartNotRequired')}</p>
          </div>;
        })}</div></section> : null;
    })}
    {!items.length ? <p>{t('property.noMatches')}</p> : null}
  </div>;
}
