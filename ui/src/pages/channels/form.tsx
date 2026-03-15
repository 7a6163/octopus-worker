import { useState } from 'preact/hooks';
import { useToast } from '@ui/hooks/use-toast';
import { createChannel, updateChannel, type Channel } from '@ui/api/channels';
import { Modal } from '@ui/components/ui/modal';
import { Input } from '@ui/components/ui/input';
import { Select } from '@ui/components/ui/select';
import { Button } from '@ui/components/ui/button';
import { Toggle } from '@ui/components/ui/toggle';
import { CHANNEL_TYPE_OPTIONS, AUTO_GROUP_OPTIONS } from '@ui/utils/constants';
import { inputValue, selectValue, type InputEvent, type SelectEvent } from '@ui/utils/events';

interface ChannelFormProps {
  channel: Channel | null;
  onClose: () => void;
  onSaved: () => void;
}

interface KeyEntry {
  enabled: boolean;
  channel_key: string;
  remark: string;
}

interface BaseUrlEntry {
  url: string;
  delay: number;
}

export function ChannelForm({ channel, onClose, onSaved }: ChannelFormProps) {
  const toast = useToast();
  const isEdit = !!channel;

  const [name, setName] = useState(channel?.name ?? '');
  const [type, setType] = useState(channel?.type ?? 0);
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [model, setModel] = useState(channel?.model ?? '');
  const [customModel, setCustomModel] = useState(channel?.custom_model ?? '');
  const [autoSync, setAutoSync] = useState(channel?.auto_sync ?? false);
  const [autoGroup, setAutoGroup] = useState(channel?.auto_group ?? 0);
  const [matchRegex, setMatchRegex] = useState(channel?.match_regex ?? '');
  const [proxy, setProxy] = useState(channel?.proxy ?? false);
  const [baseUrls, setBaseUrls] = useState<BaseUrlEntry[]>(channel?.base_urls ?? [{ url: '', delay: 0 }]);
  const [keys, setKeys] = useState<KeyEntry[]>(
    isEdit ? [] : [{ enabled: true, channel_key: '', remark: '' }],
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        name, type, enabled,
        base_urls: baseUrls.filter((u) => u.url),
        model, custom_model: customModel,
        auto_sync: autoSync, auto_group: autoGroup,
        match_regex: matchRegex, proxy,
      };

      if (isEdit) {
        await updateChannel(channel.id, data as Partial<Channel>);
        toast.success('Channel updated');
      } else {
        const validKeys = keys.filter((k) => k.channel_key);
        await createChannel({ ...data, keys_to_add: validKeys } as Partial<Channel> & { keys_to_add?: KeyEntry[] });
        toast.success('Channel created');
      }
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit: ${channel.name}` : 'Add Channel'} wide>
      <form onSubmit={handleSubmit} class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <Input label="Name" value={name} onInput={(e: InputEvent) => setName(inputValue(e))} required />
          <Select label="Type" options={CHANNEL_TYPE_OPTIONS} value={type} onChange={(e: SelectEvent) => setType(Number(selectValue(e)))} />
        </div>

        <div class="flex items-center gap-4">
          <label class="text-sm text-slate-300">Enabled</label>
          <Toggle checked={enabled} onChange={setEnabled} />
          <label class="text-sm text-slate-300 ml-4">Proxy</label>
          <Toggle checked={proxy} onChange={setProxy} />
        </div>

        <div>
          <label class="text-sm font-medium text-slate-300 mb-2 block">Base URLs</label>
          {baseUrls.map((u, i) => (
            <div key={i} class="flex gap-2 mb-2">
              <Input
                class="flex-1"
                placeholder="https://api.openai.com/v1"
                value={u.url}
                onInput={(e: InputEvent) => {
                  const updated = [...baseUrls];
                  updated[i] = { ...u, url: inputValue(e) };
                  setBaseUrls(updated);
                }}
              />
              <Input
                class="w-20"
                type="number"
                placeholder="Delay"
                value={String(u.delay)}
                onInput={(e: InputEvent) => {
                  const updated = [...baseUrls];
                  updated[i] = { ...u, delay: Number(inputValue(e)) };
                  setBaseUrls(updated);
                }}
              />
              {baseUrls.length > 1 && (
                <Button variant="ghost" size="sm" type="button" onClick={() => setBaseUrls(baseUrls.filter((_, j) => j !== i))}>
                  &times;
                </Button>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" type="button" onClick={() => setBaseUrls([...baseUrls, { url: '', delay: 0 }])}>
            + Add URL
          </Button>
        </div>

        <Input label="Models (comma-separated)" value={model} onInput={(e: InputEvent) => setModel(inputValue(e))} placeholder="gpt-4o,gpt-4o-mini" />
        <Input label="Custom Model" value={customModel} onInput={(e: InputEvent) => setCustomModel(inputValue(e))} />

        <div class="grid grid-cols-2 gap-4">
          <div class="flex items-center gap-4">
            <label class="text-sm text-slate-300">Auto Sync</label>
            <Toggle checked={autoSync} onChange={setAutoSync} />
          </div>
          <Select label="Auto Group" options={AUTO_GROUP_OPTIONS} value={autoGroup} onChange={(e: SelectEvent) => setAutoGroup(Number(selectValue(e)))} />
        </div>

        <Input label="Match Regex" value={matchRegex} onInput={(e: InputEvent) => setMatchRegex(inputValue(e))} placeholder="^gpt-|^o[0-9]" />

        {!isEdit && (
          <div>
            <label class="text-sm font-medium text-slate-300 mb-2 block">API Keys</label>
            {keys.map((k, i) => (
              <div key={i} class="flex gap-2 mb-2">
                <Input
                  class="flex-1"
                  placeholder="sk-..."
                  value={k.channel_key}
                  onInput={(e: InputEvent) => {
                    const updated = [...keys];
                    updated[i] = { ...k, channel_key: inputValue(e) };
                    setKeys(updated);
                  }}
                />
                <Input
                  class="w-32"
                  placeholder="Remark"
                  value={k.remark}
                  onInput={(e: InputEvent) => {
                    const updated = [...keys];
                    updated[i] = { ...k, remark: inputValue(e) };
                    setKeys(updated);
                  }}
                />
                {keys.length > 1 && (
                  <Button variant="ghost" size="sm" type="button" onClick={() => setKeys(keys.filter((_, j) => j !== i))}>
                    &times;
                  </Button>
                )}
              </div>
            ))}
            <Button variant="ghost" size="sm" type="button" onClick={() => setKeys([...keys, { enabled: true, channel_key: '', remark: '' }])}>
              + Add Key
            </Button>
          </div>
        )}

        <div class="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  );
}
