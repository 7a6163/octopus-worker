import { useState } from 'preact/hooks';
import { useToast } from '@ui/hooks/use-toast';
import { createUser, updateUser, type User } from '@ui/api/users';
import { Modal } from '@ui/components/ui/modal';
import { Input } from '@ui/components/ui/input';
import { Select } from '@ui/components/ui/select';
import { Button } from '@ui/components/ui/button';
import { inputValue, selectValue, type InputEvent, type SelectEvent } from '@ui/utils/events';

interface UserFormProps {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}

export function UserForm({ user, onClose, onSaved }: UserFormProps) {
  const toast = useToast();
  const isEdit = !!user;

  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(user?.role ?? 'user');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) {
        const data: Partial<User & { password?: string }> = { username, role };
        if (password) data.password = password;
        await updateUser(user.id, data);
        toast.success('User updated');
      } else {
        await createUser({ username, password, role });
        toast.success('User created');
      }
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit: ${user.username}` : 'Add User'}>
      <form onSubmit={handleSubmit} class="space-y-4">
        <Input label="Username" value={username} onInput={(e: InputEvent) => setUsername(inputValue(e))} required />
        <Input
          label={isEdit ? 'New Password (leave blank to keep)' : 'Password'}
          type="password"
          value={password}
          onInput={(e: InputEvent) => setPassword(inputValue(e))}
          required={!isEdit}
        />
        <Select
          label="Role"
          value={role}
          options={[{ value: 'admin', label: 'Admin' }, { value: 'user', label: 'User' }]}
          onChange={(e: SelectEvent) => setRole(selectValue(e))}
        />

        <div class="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  );
}
