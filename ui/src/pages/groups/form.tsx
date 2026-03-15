import { useState } from 'preact/hooks';
import { useToast } from '@ui/hooks/use-toast';
import { createGroup, updateGroup, type Group } from '@ui/api/groups';
import { Modal } from '@ui/components/ui/modal';
import { Input } from '@ui/components/ui/input';
import { Select } from '@ui/components/ui/select';
import { Button } from '@ui/components/ui/button';
import { GROUP_MODE_OPTIONS } from '@ui/utils/constants';
import { inputValue, selectValue, type InputEvent, type SelectEvent } from '@ui/utils/events';

interface GroupFormProps {
  group: Group | null;
  onClose: () => void;
  onSaved: () => void;
}

export function GroupForm({ group, onClose, onSaved }: GroupFormProps) {
  const toast = useToast();
  const isEdit = !!group;

  const [name, setName] = useState(group?.name ?? '');
  const [mode, setMode] = useState(group?.mode ?? 1);
  const [matchRegex, setMatchRegex] = useState(group?.match_regex ?? '');
  const [firstTokenTimeout, setFirstTokenTimeout] = useState(group?.first_token_timeout ?? 0);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { name, mode, match_regex: matchRegex, first_token_timeout: firstTokenTimeout };
      if (isEdit) {
        await updateGroup(group.id, data);
        toast.success('Group updated');
      } else {
        await createGroup(data);
        toast.success('Group created');
      }
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit: ${group.name}` : 'Add Group'}>
      <form onSubmit={handleSubmit} class="space-y-4">
        <Input label="Name (model name)" value={name} onInput={(e: InputEvent) => setName(inputValue(e))} required placeholder="gpt-4o" />
        <Select label="Mode" options={GROUP_MODE_OPTIONS} value={mode} onChange={(e: SelectEvent) => setMode(Number(selectValue(e)))} />
        <Input label="Match Regex" value={matchRegex} onInput={(e: InputEvent) => setMatchRegex(inputValue(e))} placeholder="Optional regex" />
        <Input label="First Token Timeout (sec)" type="number" value={String(firstTokenTimeout)} onInput={(e: InputEvent) => setFirstTokenTimeout(Number(inputValue(e)))} />

        <div class="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  );
}
