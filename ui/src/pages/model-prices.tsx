import { useState } from 'preact/hooks';
import { useApi } from '@ui/hooks/use-api';
import { useToast } from '@ui/hooks/use-toast';
import { getModelList, triggerPriceSync } from '@ui/api/stats';
import { Table } from '@ui/components/ui/table';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { inputValue, type InputEvent } from '@ui/utils/events';

export function ModelPricesPage() {
  const { data, loading, refetch } = useApi(getModelList);
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');

  const handleSync = async () => {
    setSyncing(true);
    try {
      await triggerPriceSync();
      toast.success('Price sync complete');
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const filtered = (data || []).filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (loading) return <p class="text-slate-400">Loading...</p>;

  return (
    <div class="space-y-4">
      <div class="flex items-center gap-4">
        <Input
          placeholder="Search models..."
          value={search}
          onInput={(e: InputEvent) => setSearch(inputValue(e))}
          class="max-w-xs"
        />
        <Button variant="secondary" onClick={handleSync} loading={syncing}>Sync Prices</Button>
      </div>

      <Table
        columns={[
          { key: 'name', header: 'Model' },
          { key: 'input', header: 'Input ($/M)', render: (r) => <span>${r.input}</span> },
          { key: 'output', header: 'Output ($/M)', render: (r) => <span>${r.output}</span> },
          { key: 'cache_read', header: 'Cache Read', render: (r) => <span>{r.cache_read ? `$${r.cache_read}` : '--'}</span> },
          { key: 'cache_write', header: 'Cache Write', render: (r) => <span>{r.cache_write ? `$${r.cache_write}` : '--'}</span> },
        ]}
        data={filtered}
        keyFn={(r) => r.name}
        empty="No pricing data. Click Sync Prices."
      />
    </div>
  );
}
