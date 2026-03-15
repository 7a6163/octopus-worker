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
        <StatsCard label="Requests" value={formatNumber(stats?.requests ?? 0)} />
        <StatsCard label="Total Cost" value={formatCost(stats?.cost ?? 0)} />
        <StatsCard
          label="Input Tokens"
          value={formatTokens(stats?.input_tokens ?? 0)}
          sub={`Output: ${formatTokens(stats?.output_tokens ?? 0)}`}
        />
        <StatsCard
          label="Cache Read"
          value={formatTokens(stats?.cache_read_tokens ?? 0)}
          sub={`Write: ${formatTokens(stats?.cache_write_tokens ?? 0)}`}
        />
      </div>

      {hourly.data && <HourlyChart data={hourly.data} />}

      <div class="grid lg:grid-cols-2 gap-6">
        {channels.data && (
          <div>
            <h3 class="text-sm font-medium text-slate-400 mb-3">Channel Usage</h3>
            <Table
              columns={[
                { key: 'channel_name', header: 'Channel' },
                { key: 'requests', header: 'Requests', render: (r) => formatNumber(r.requests) },
                { key: 'cost', header: 'Cost', render: (r) => formatCost(r.cost) },
              ]}
              data={channels.data}
              keyFn={(r) => r.channel_id}
            />
          </div>
        )}
        {apikeys.data && (
          <div>
            <h3 class="text-sm font-medium text-slate-400 mb-3">API Key Usage</h3>
            <Table
              columns={[
                { key: 'api_key_name', header: 'API Key' },
                { key: 'requests', header: 'Requests', render: (r) => formatNumber(r.requests) },
                { key: 'cost', header: 'Cost', render: (r) => formatCost(r.cost) },
              ]}
              data={apikeys.data}
              keyFn={(r) => r.api_key_id}
            />
          </div>
        )}
      </div>
    </div>
  );
}
