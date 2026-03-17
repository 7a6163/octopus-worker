import { useState } from 'preact/hooks';
import { useApi } from '@ui/hooks/use-api';
import { useToast } from '@ui/hooks/use-toast';
import { listGroups, deleteGroup, type Group } from '@ui/api/groups';
import { Table } from '@ui/components/ui/table';
import { Button } from '@ui/components/ui/button';
import { Badge } from '@ui/components/ui/badge';
import { ConfirmDialog } from '@ui/components/ui/confirm-dialog';
import { GROUP_MODES } from '@ui/utils/constants';
import { GroupForm } from './form';

export function GroupListPage() {
  const { data, loading, refetch } = useApi(listGroups);
  const toast = useToast();
  const [editing, setEditing] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      await deleteGroup(deleting.id);
      toast.success('Group deleted');
      setDeleting(null);
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading) return <p class="text-slate-400">Loading...</p>;

  return (
    <div class="space-y-4">
      <Button onClick={() => setCreating(true)}>Add Group</Button>

      <Table
        columns={[
          { key: 'name', header: 'Name' },
          {
            key: 'mode',
            header: 'Mode',
            render: (r) => <Badge color="purple">{GROUP_MODES[r.mode] || `Mode ${r.mode}`}</Badge>,
          },
          {
            key: 'items',
            header: 'Items',
            render: (r) => <span>{r.items?.length ?? 0}</span>,
          },
          { key: 'matchRegex', header: 'Regex', render: (r) => <span class="text-xs text-slate-400">{r.matchRegex || '--'}</span> },
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
        empty="No groups. Create one to start load balancing."
      />

      {(creating || editing) && (
        <GroupForm
          group={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); refetch(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete Group"
        message={`Delete group "${deleting?.name}"?`}
        loading={deleteLoading}
      />
    </div>
  );
}
