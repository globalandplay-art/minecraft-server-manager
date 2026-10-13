import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../api';
import { TailscaleControls } from './TailscaleControls';

export function TailscaleAccess() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['tailscale-readonly'], queryFn: ({ signal }) => api.tailscaleStatus(signal), retry: false });
  const check = useMutation({ mutationFn: api.tailscalePreflight, onSuccess: (data) => client.setQueryData(['tailscale-readonly'], data) });
  const status = query.data?.data;
  return <section className="explanation-card" aria-label="Tailscale Serve">
    <div><h2>Security &amp; Access · Tailscale Serve</h2>
      <p>私有远程访问默认关闭。此处仅检查依赖和现有配置，不会创建或删除路由。</p>
      <dl>
        <dt>状态</dt><dd>{check.isPending ? 'checking' : status?.state ?? '尚未读取'}</dd>
        <dt>启动默认策略</dt><dd>关闭</dd>
        <dt>配置归属</dt><dd>外部管理；未证明 Manager 所有权</dd>
        <dt>依赖 / Tailnet / HTTPS</dt><dd>{status ? `${status.dependency} / ${status.tailnet} / ${status.https}` : '未知'}</dd>
        <dt>Serve / Funnel</dt><dd>{status?.observedServeMode ?? 'unknown'}</dd>
        <dt>受控本地入口</dt><dd>未配置</dd>
        <dt>远端验收</dt><dd>未验证；没有可连接 URL</dd>
        <dt>上次检查</dt><dd>{status?.lastCheckedAt ?? '尚未执行'}</dd>
      </dl>
      {status?.lastErrorCode ? <p role="status">{status.lastErrorCode}</p> : null}
      {query.error || check.error ? <p role="alert">{errorMessage(check.error ?? query.error)}</p> : null}
      <button className="button button--secondary" disabled={check.isPending || query.isPending || Boolean(query.error)} onClick={() => check.mutate()}>只读预检（需要近期管理员验证）</button>
      <p>本地管理入口保留。Cloudflare 独立配置尚未实现。</p>
      <TailscaleControls />
    </div>
  </section>;
}
