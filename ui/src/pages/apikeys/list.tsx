import { useState } from 'preact/hooks';
import { useApi } from '@ui/hooks/use-api';
import { useToast } from '@ui/hooks/use-toast';
import { listApiKeys, deleteApiKey, updateApiKey, type ApiKey } from '@ui/api/apikeys';
import { Table } from '@ui/components/ui/table';
import { Button } from '@ui/components/ui/button';
import { Toggle } from '@ui/components/ui/toggle';
import { ConfirmDialog } from '@ui/components/ui/confirm-dialog';
import { ApiKeyForm } from './form';
import { formatCost, formatDate } from '@ui/utils/format';

export function ApiKeyListPage() {
  const { data, loading, refetch } = useApi(listApiKeys);
  const toast = useToast();
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ApiKey | null>(null);

  const handleToggle = async (key: ApiKey, enabled: boolean) => {
    try {
      await updateApiKey(key.id, { enabled });
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteApiKey(deleting.id);
      toast.success('API key deleted');
      setDeleting(null);
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (loading) return <p class="text-slate-400">Loading...</p>;

  return (
    <div class="space-y-4">
      <Button onClick={() => setCreating(true)}>Add API Key</Button>

      <Table
        columns={[
          { key: 'name', header: 'Name' },
          {
            key: 'apiKey',
            header: 'Key',
            render: (r) => <code class="text-xs text-slate-400">{r.apiKey}</code>,
          },
          {
            key: 'enabled',
            header: 'Enabled',
            render: (r) => <Toggle checked={r.enabled} onChange={(v) => handleToggle(r, v)} />,
          },
          {
            key: 'maxCost',
            header: 'Max Cost',
            render: (r) => <span>{r.maxCost ? formatCost(r.maxCost) : 'Unlimited'}</span>,
          },
          {
            key: 'expireAt',
            header: 'Expires',
            render: (r) => <span class="text-xs">{r.expireAt ? formatDate(r.expireAt) : 'Never'}</span>,
          },
          {
            key: 'actions',
            header: '',
            render: (r) => (
              <div class="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(r)}>Delete</Button>
              </div>
            ),
          },
        ]}
        data={data || []}
        keyFn={(r) => r.id}
        empty="No API keys."
      />

      {(creating || editing) && (
        <ApiKeyForm
          apiKey={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); refetch(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete API Key"
        message={`Delete "${deleting?.name}"?`}
      />
    </div>
  );
}
