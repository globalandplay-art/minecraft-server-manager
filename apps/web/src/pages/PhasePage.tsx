import type { HealthResponse, ServersResponse } from '@mcsm/contracts';
import { Info, LockKeyhole, ShieldCheck } from 'lucide-react';
import { PageHeading, PhaseNotice } from '../components/Ui';

type Features = HealthResponse['data']['features'];
type ServerSummary = ServersResponse['data']['items'][number];

const content = {
  players: { title: 'Players', feature: 'players', description: '在线名单、身份与玩家管理', detail: 'Phase 4 将在后端提供可信玩家来源后接入。当前不会根据在线人数虚构玩家姓名或头像。' },
  worlds: { title: 'Worlds', feature: 'worlds', description: '世界、维度与存档管理', detail: 'Phase 3 将以完整 world set 管理主世界、下界和末地，并在变更前明确停服与快照影响。' },
  addons: { title: 'Mods / Plugins', feature: 'addons', description: '受控扩展管理', detail: 'Phase 5 将按服务端能力呈现 Mods 或 Plugins，并在文件变更前执行兼容性与安全校验。' },
  console: { title: 'Console', feature: 'console', description: '服务端日志与命令通道', detail: 'Phase 2 将接入真实日志流和明确来源的命令通道。当前没有输入框，也不会模拟命令成功。' },
  performance: { title: 'Performance', feature: 'performance', description: '真实采样与历史趋势', detail: 'Phase 6 在具备可信历史采样后提供趋势；当前 Dashboard 只展示带来源的单次快照。' },
  backups: { title: 'Backups', feature: 'backups', description: '一致性备份与恢复', detail: 'Phase 3 将提供停服一致性快照、校验与可回滚的恢复事务。当前没有上传或恢复操作。' },
  crashes: { title: 'Crash Analysis', feature: 'crashAnalysis', description: '本地日志证据分析', detail: 'Phase 6 将使用本地规则与脱敏日志证据辅助定位，不会把无法确认的原因标成确定结论。' },
} as const;

export type PhasePageKind = keyof typeof content;

export function PhasePage({ kind, features, server }: { kind: PhasePageKind; features?: Features | undefined; server?: ServerSummary | undefined }) {
  const page = content[kind];
  const state = features?.[page.feature];
  const phase = state?.phase ?? Number(page.detail.match(/Phase (\d+)/)?.[1] ?? 1);
  const noAddons = kind === 'addons' && server && !server.capabilities.mods && !server.capabilities.plugins;
  return (
    <div className="page-stack">
      <PageHeading eyebrow="ROADMAP" title={page.title} description={page.description} />
      {noAddons ? (
        <section className="state-card state-card--empty">
          <span className="state-card__icon"><Info size={24} /></span>
          <h2>此实例不支持 Mods / Plugins</h2>
          <p>{server.server.type.toUpperCase()} 的后端能力声明中 Mods 与 Plugins 均不可用。切换到受支持实例后再查看。</p>
        </section>
      ) : (
        <PhaseNotice phase={phase} title={`${page.title} 尚未在 Phase 1 启用`}>{page.detail}</PhaseNotice>
      )}
      <div className="explanation-grid">
        <article className="explanation-card"><LockKeyhole size={20} /><div><h3>当前保持只读</h3><p>没有隐藏的写接口或空操作按钮，避免把占位交互误认为已执行。</p></div></article>
        <article className="explanation-card"><ShieldCheck size={20} /><div><h3>能力由后端声明</h3><p>功能实现、服务端能力与当前可操作状态分别校验，页面不会自行猜测。</p></div></article>
      </div>
    </div>
  );
}

export function SettingsPage({ features }: { features?: Features | undefined }) {
  const propertiesPhase = features?.properties.phase;
  const remotePhase = features?.remoteAccess.phase;
  return (
    <div className="page-stack">
      <PageHeading eyebrow="LOCAL MANAGER" title="Settings" description="连接信息始终可见；配置编辑与远程访问按各自阶段启用。" />
      <section className="settings-panel">
        <div><span className="settings-icon"><ShieldCheck size={21} /></span><div><h2>本地连接</h2><p>管理器 API 仅监听 127.0.0.1:8080，前端通过同源代理访问。当前没有远程登录入口。</p></div><span className="phase-badge">只读</span></div>
        <div><span className="settings-icon"><Info size={21} /></span><div><h2>Server Properties</h2><p>Phase {propertiesPhase ?? '未知'} 才会提供白名单字段、变更对比与 revision 冲突保护。</p></div><span className="phase-badge">P{propertiesPhase ?? '—'}</span></div>
        <div><span className="settings-icon"><LockKeyhole size={21} /></span><div><h2>Remote Access</h2><p>Phase {remotePhase ?? '未知'} 将独立设计认证、授权、TLS 与审计；当前不会扩大监听地址。</p></div><span className="phase-badge">P{remotePhase ?? '—'}</span></div>
      </section>
    </div>
  );
}
