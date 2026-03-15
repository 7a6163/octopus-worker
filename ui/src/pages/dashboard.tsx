import { useApi } from '@ui/hooks/use-api';
import { getToday, getHourly, getChannelStats, getApiKeyStats } from '@ui/api/stats';
import { StatsCard } from '@ui/components/charts/stats-card';
import { HourlyChart } from '@ui/components/charts/hourly-chart';
import { Table } from '@ui/components/ui/table';
import { formatNumber, formatCost, formatTokens } from '@ui/utils/format';

export function DashboardPage() {
  const today = useApi(getToday);
  const hourly = useApi(getHourly);
  const channels = useApi(getChannelStats);
  const apikeys = useApi(getApiKeyStats);

  if (today.loading) {
    return <p class="text-slate-400">Loading...</p>;
  }

  const stats = today.data;

  return (
    <div class="space-y-6">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Requests" value={formatNumber(stats?.totalRequests ?? 0)} />
        <StatsCard label="Total Cost" value={formatCost(stats?.totalCost ?? 0)} />
        <StatsCard
          label="Input Tokens"
          value={formatTokens(stats?.totalInputTokens ?? 0)}
          sub={`Output: ${formatTokens(stats?.totalOutputTokens ?? 0)}`}
        />
        <StatsCard
          label="Success"
          value={formatNumber(stats?.successRequests ?? 0)}
          sub={`Failed: ${formatNumber(stats?.failedRequests ?? 0)}`}
        />
      </div>

      {hourly.data && <HourlyChart data={hourly.data} />}

      <div class="grid lg:grid-cols-2 gap-6">
        {channels.data && (
          <div>
            <h3 class="text-sm font-medium text-slate-400 mb-3">Channel Usage</h3>
            <Table
              columns={[
                { key: 'channelName', header: 'Channel' },
                { key: 'totalRequests', header: 'Requests', render: (r) => formatNumber(r.totalRequests) },
                { key: 'totalCost', header: 'Cost', render: (r) => formatCost(r.totalCost) },
              ]}
              data={channels.data}
              keyFn={(r) => r.channelId}
            />
          </div>
        )}
        {apikeys.data && (
          <div>
            <h3 class="text-sm font-medium text-slate-400 mb-3">API Key Usage</h3>
            <Table
              columns={[
                { key: 'apiKeyName', header: 'API Key' },
                { key: 'requestSuccess', header: 'Requests', render: (r) => formatNumber(r.requestSuccess + r.requestFailed) },
                { key: 'inputCost', header: 'Cost', render: (r) => formatCost(r.inputCost + r.outputCost) },
              ]}
              data={apikeys.data}
              keyFn={(r) => r.apiKeyId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
