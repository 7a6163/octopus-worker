import { useState } from 'preact/hooks';
import { useApi } from '@ui/hooks/use-api';
import { useToast } from '@ui/hooks/use-toast';
import { listUsers, deleteUser, type User } from '@ui/api/users';
import { Table } from '@ui/components/ui/table';
import { Button } from '@ui/components/ui/button';
import { Badge } from '@ui/components/ui/badge';
import { ConfirmDialog } from '@ui/components/ui/confirm-dialog';
import { UserForm } from './form';

export function UserListPage() {
  const { data, loading, refetch } = useApi(listUsers);
  const toast = useToast();
  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<User | null>(null);

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteUser(deleting.id);
      toast.success('User deleted');
      setDeleting(null);
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (loading) return <p class="text-slate-400">Loading...</p>;

  return (
    <div class="space-y-4">
      <Button onClick={() => setCreating(true)}>Add User</Button>

      <Table
        columns={[
          { key: 'username', header: 'Username' },
          {
            key: 'role',
            header: 'Role',
            render: (r) => <Badge color={r.role === 'admin' ? 'purple' : 'blue'}>{r.role}</Badge>,
          },
          {
            key: 'enabled',
            header: 'Status',
            render: (r) => <Badge color={r.enabled ? 'green' : 'red'}>{r.enabled ? 'Active' : 'Disabled'}</Badge>,
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
      />

      {(creating || editing) && (
        <UserForm
          user={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); refetch(); }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
        title="Delete User"
        message={`Delete user "${deleting?.username}"?`}
      />
    </div>
  );
}
