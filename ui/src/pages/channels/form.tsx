import { useState } from 'preact/hooks';
import { useToast } from '@ui/hooks/use-toast';
import { createChannel, updateChannel, fetchModels, type Channel } from '@ui/api/channels';
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
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    new Set(channel?.model ? channel.model.split(',').filter(Boolean) : [])
  );
  const [customModel, setCustomModel] = useState(channel?.customModel ?? '');
  const [autoSync, setAutoSync] = useState(channel?.autoSync ?? false);
  const [autoGroup, setAutoGroup] = useState(channel?.autoGroup ?? 0);
  const [matchRegex, setMatchRegex] = useState(channel?.matchRegex ?? '');
  const [proxy, setProxy] = useState(channel?.proxy ?? false);
  const [baseUrls, setBaseUrls] = useState<BaseUrlEntry[]>(channel?.baseUrls ?? [{ url: '', delay: 0 }]);
  const [keys, setKeys] = useState<KeyEntry[]>(
    isEdit
      ? channel.keys.map((k) => ({ enabled: k.enabled, channel_key: k.channelKey, remark: k.remark }))
      : [{ enabled: true, channel_key: '', remark: '' }],
  );
  const [saving, setSaving] = useState(false);

  // Model fetching state
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFilter, setModelFilter] = useState('');

  const handleFetchModels = async () => {
    const url = baseUrls[0]?.url;
    const key = keys[0]?.channel_key;

    if (!url) {
      toast.error('Please enter a Base URL first');
      return;
    }
    if (!key) {
      toast.error('Please enter an API Key first');
      return;
    }

    setFetchingModels(true);
    try {
      const models = await fetchModels({ base_url: url, key, type });
      setAvailableModels(models.sort());
      if (models.length === 0) {
        toast.info('No models returned from upstream');
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setFetchingModels(false);
    }
  };

  const toggleModel = (model: string) => {
    const next = new Set(selectedModels);
    if (next.has(model)) {
      next.delete(model);
    } else {
      next.add(model);
    }
    setSelectedModels(next);
  };

  const selectAllFiltered = () => {
    const next = new Set(selectedModels);
    for (const m of filteredModels) {
      next.add(m);
    }
    setSelectedModels(next);
  };

  const deselectAllFiltered = () => {
    const next = new Set(selectedModels);
    for (const m of filteredModels) {
      next.delete(m);
    }
    setSelectedModels(next);
  };

  const filteredModels = modelFilter
    ? availableModels.filter((m) => m.toLowerCase().includes(modelFilter.toLowerCase()))
    : availableModels;

  const modelString = [...selectedModels].join(',');

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setSaving(true);
    try {
      const allModels = [modelString, customModel].filter(Boolean).join(',');
      const data: Record<string, unknown> = {
        name, type, enabled,
        base_urls: baseUrls.filter((u) => u.url),
        model: allModels, custom_model: customModel,
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

        <div>
          <label class="text-sm font-medium text-slate-300 mb-2 block">
            API Keys
            {isEdit && <span class="text-xs text-slate-500 ml-2">(existing keys shown as masked)</span>}
          </label>
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

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-sm font-medium text-slate-300">Models</label>
            {!autoSync && (
              <Button
                size="sm"
                type="button"
                loading={fetchingModels}
                onClick={handleFetchModels}
              >
                Fetch Models
              </Button>
            )}
          </div>

          {autoSync && (
            <p class="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mb-3">
              Auto Sync is enabled — models will be fetched from upstream automatically (hourly).
              {matchRegex ? ` Filtered by: ${matchRegex}` : ' Use Match Regex below to filter models.'}
            </p>
          )}

          {availableModels.length > 0 && (
            <div class="mb-3">
              <div class="flex gap-2 mb-2">
                <Input
                  class="flex-1"
                  placeholder="Filter models..."
                  value={modelFilter}
                  onInput={(e: InputEvent) => setModelFilter(inputValue(e))}
                />
                <Button variant="ghost" size="sm" type="button" onClick={selectAllFiltered}>
                  All
                </Button>
                <Button variant="ghost" size="sm" type="button" onClick={deselectAllFiltered}>
                  None
                </Button>
              </div>
              <div class="max-h-48 overflow-y-auto rounded-lg border border-slate-600 bg-slate-900/50 p-2 space-y-0.5">
                {filteredModels.map((m) => (
                  <label key={m} class="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700/50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selectedModels.has(m)}
                      onChange={() => toggleModel(m)}
                      class="rounded border-slate-500 accent-blue-500"
                    />
                    <span class="text-slate-300 truncate">{m}</span>
                  </label>
                ))}
                {filteredModels.length === 0 && (
                  <p class="text-xs text-slate-500 px-2 py-1">No models match filter</p>
                )}
              </div>
              <p class="text-xs text-slate-500 mt-1">
                {selectedModels.size} selected
                {modelFilter && ` (showing ${filteredModels.length} of ${availableModels.length})`}
              </p>
            </div>
          )}

          {selectedModels.size > 0 && (
            <div class="flex flex-wrap gap-1 mb-2">
              {[...selectedModels].map((m) => (
                <span
                  key={m}
                  class="inline-flex items-center gap-1 rounded-md bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-xs text-blue-300"
                >
                  {m}
                  <button type="button" onClick={() => toggleModel(m)} class="hover:text-red-400 cursor-pointer">&times;</button>
                </span>
              ))}
            </div>
          )}
        </div>

        <Input
          label="Custom Models"
          value={customModel}
          onInput={(e: InputEvent) => setCustomModel(inputValue(e))}
          placeholder="model-not-in-list,another-model"
        />
        <p class="text-xs text-slate-500 -mt-3">Comma-separated. For models not available via upstream fetch.</p>

        <div class="grid grid-cols-2 gap-4">
          <div class="flex items-center gap-4">
            <label class="text-sm text-slate-300">Auto Sync</label>
            <Toggle checked={autoSync} onChange={setAutoSync} />
          </div>
          <Select label="Auto Group" options={AUTO_GROUP_OPTIONS} value={autoGroup} onChange={(e: SelectEvent) => setAutoGroup(Number(selectValue(e)))} />
        </div>

        <Input label="Match Regex" value={matchRegex} onInput={(e: InputEvent) => setMatchRegex(inputValue(e))} placeholder="^gpt-|^o[0-9]" />

        <div class="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </form>
    </Modal>
  );
}
