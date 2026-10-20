import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ConfigurationDiscovery } from '@mcsm/contracts';
import { PropertiesFields } from './PropertiesFields';
afterEach(cleanup);
const item: ConfigurationDiscovery['items'][number] = { key: 'pvp', label: '玩家对战', group: '游戏玩法', category: 'core',
  rawValue: 'true', value: true, inferredType: 'boolean', source: 'server.properties', fileId: 'server-properties',
  ruleStatus: 'verified', editable: true, sensitive: false, duplicate: false, restartRequired: true, reason: null, description: '已验证' };
const discovery: ConfigurationDiscovery = { serverType: 'vanilla', minecraftVersion: '26.3', fileIdentity: 'a'.repeat(64), omittedCount: 0,
  files: [{ id: 'server-properties', source: 'server.properties', format: 'properties', editable: true }], items: [item] };
it('renders new observed metadata without React schema changes, removes vanished fields and never duplicates core', () => {
  const onChange = vi.fn();
  const props = { values: {}, rules: {}, disabled: false, onChange };
  const view = render(<PropertiesFields {...props} discovery={discovery} />);
  expect(screen.getAllByText('pvp')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('玩家对战'), {target:{value:'false'}});
  expect(onChange).toHaveBeenCalledWith('pvp','false');
  view.rerender(<PropertiesFields {...props} discovery={{...discovery,items:[{...item,key:'new-performance-option',label:'new-performance-option',category:'unknown',editable:false,rawValue:'12',value:12,inferredType:'number',ruleStatus:'unverified',restartRequired:null,reason:'VERSION_RULE_UNAVAILABLE'}]}} />);
  expect(screen.queryByLabelText('玩家对战')).not.toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'新发现的未知配置'})).toBeInTheDocument();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(screen.getByText(/重启要求未知/)).toBeInTheDocument();
});
it('searches Chinese names and English keys with file filtering', () => {
  render(<PropertiesFields discovery={discovery} values={{}} rules={{}} disabled={false} onChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('搜索配置'),{target:{value:'玩家'}});
  expect(screen.getByLabelText('玩家对战')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('搜索配置'),{target:{value:'not-present'}});
  expect(screen.queryByLabelText('玩家对战')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('搜索配置'),{target:{value:'pvp'}});
  fireEvent.change(screen.getByLabelText('配置文件'),{target:{value:'server-properties'}});
  expect(screen.getByLabelText('玩家对战')).toBeInTheDocument();
});
it.each(['true','1234'])('uses verified string grammar for numeric/boolean-looking MOTD %s', rawValue => {
  const onChange = vi.fn();
  render(<PropertiesFields discovery={{...discovery,items:[{...item,key:'motd',label:'服务器描述',rawValue,inferredType:rawValue === 'true' ? 'boolean' : 'number'}]}}
    values={{motd:rawValue}} rules={{}} disabled={false} onChange={onChange} />);
  const input = screen.getByRole('textbox',{name:'服务器描述'});
  fireEvent.change(input,{target:{value:'Hello world'}});
  expect(onChange).toHaveBeenCalledWith('motd','Hello world');
});
