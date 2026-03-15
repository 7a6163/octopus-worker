import { useState } from 'preact/hooks';
import { useToast } from '@ui/hooks/use-toast';
import { createApiKey, updateApiKey, type ApiKey } from '@ui/api/apikeys';
import { Modal } from '@ui/components/ui/modal';
import { Input } from '@ui/components/ui/input';
import { Button } from '@ui/components/ui/button';
import { inputValue, type InputEvent } from '@ui/utils/events';

interface ApiKeyFormProps {
  apiKey: ApiKey | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ApiKeyForm({ apiKey, onClose, onSaved }: ApiKeyFormProps) {
  const toast = useToast();
  const isEdit = !!apiKey;

  const [name, setName] = useState(apiKey?.name ?? '');
  const [maxCost, setMaxCost] = useState(apiKey?.maxCost ?? 0);
  const [supportedModels, setSupportedModels] = useState(apiKey?.supportedModels ?? '');
  const [createdKey, setCreatedKey] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { name, maxCost, supportedModels };
      if (isEdit) {
        await updateApiKey(apiKey.id, data);
        toast.success('API key updated');
        onSaved();
      } else {
        const result = await createApiKey(data);
        setCreatedKey(result.apiKey);
        toast.success('API key created');
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (createdKey) {
    return (
      <Modal open onClose={() => onSaved()} title="API Key Created">
        <p class="text-sm text-slate-300 mb-3">Save this key now. It will be masked in future requests.</p>
        <div class="flex items-center gap-2 rounded-lg bg-slate-900 border border-slate-600 px-4 py-3">
          <code class="flex-1 text-sm text-green-400 break-all">{createdKey}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(createdKey); toast.success('Copied'); }}
            class="text-sm text-blue-400 hover:text-blue-300 cursor-pointer whitespace-nowrap"
          >
            Copy
          </button>
        </div>
        <div class="flex justify-end mt-6">
          <Button onClick={() => onSaved()}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit: ${apiKey.name}` : 'Add API Key'}>
      <form onSubmit={handleSubmit} class="space-y-4">
        <Input label="Name" value={name} onInput={(e: InputEvent) => setName(inputValue(e))} required placeholder="my-app" />
        <Input label="Max Cost (USD, 0 = unlimited)" type="number" value={String(maxCost)} onInput={(e: InputEvent) => setMaxCost(Number(inputValue(e)))} />
        <Input
          label="Supported Models (comma-separated, empty = all)"
          value={supportedModels}
          onInput={(e: InputEvent) => setSupportedModels(inputValue(e))}
          placeholder="gpt-4o,claude-sonnet-4-20250514"
        />

        <div class="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  );
}
