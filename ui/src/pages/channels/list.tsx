import { useState } from 'preact/hooks';
import { useApi } from '@ui/hooks/use-api';
import { useToast } from '@ui/hooks/use-toast';
import { listChannels, deleteChannel, updateChannel, syncChannels, type Channel } from '@ui/api/channels';
import { Table } from '@ui/components/ui/table';
import { Button } from '@ui/components/ui/button';
import { Badge } from '@ui/components/ui/badge';
import { Toggle } from '@ui/components/ui/toggle';
import { ConfirmDialog } from '@ui/components/ui/confirm-dialog';
import { CHANNEL_TYPES } from '@ui/utils/constants';
import { ChannelForm } from './form';

export function ChannelListPage() {
  const { data, loading, refetch } = useApi(listChannels);
  const toast = useToast();
  const [editing, setEditing] = useState<Channel | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Channel | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleToggle = async (ch: Channel, enabled: boolean) => {
    try {
      await updateChannel(ch.id, { enabled });
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await deleteChannel(deleting.id);
      toast.success('Channel deleted');
      setDeleting(null);
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncChannels();
      toast.success('Sync triggered');
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <p class="text-slate-400">Loading...</p>;

  const typeColor = (t: number) => {
    const colors = ['blue', 'purple', 'green', 'yellow', 'red', 'slate'] as const;
    return colors[t] || 'slate';
  };

  return (
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="flex gap-2">
          <Button onClick={() => setCreating(true)}>Add Channel</Button>
          <Button variant="secondary" onClick={handleSync} loading={syncing}>Sync All</Button>
        </div>
      </div>

      <Table
        columns={[
          { key: 'name', header: 'Name' },
          {
            key: 'type',
            header: 'Type',
            render: (r) => <Badge color={typeColor(r.type)}>{CHANNEL_TYPES[r.type] || `Type ${r.type}`}</Badge>,
          },
          {
            key: 'enabled',
            header: 'Enabled',
            render: (r) => <Toggle checked={r.enabled} onChange={(v) => handleToggle(r, v)} />,
          },
          {
            key: 'model',
            header: 'Models',
            render: (r) => <span class="text-xs text-slate-400 truncate max-w-48 inline-block">{r.model || '--'}</span>,
          },
          {
            key: 'keys',
            header: 'Keys',
            render: (r) => <span>{r.keys?.length ?? 0}</span>,
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
        empty="No channels. Add one to get started."
      />

      {(creating || editing) && (
        <ChannelForm
          channel={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); refetch(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete Channel"
        message={`Delete "${deleting?.name}"? This also removes associated keys and group items.`}
        loading={deleteLoading}
      />
    </div>
  );
}
