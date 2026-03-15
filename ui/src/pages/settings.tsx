import { useState } from 'preact/hooks';
import { useApi } from '@ui/hooks/use-api';
import { useToast } from '@ui/hooks/use-toast';
import { getSettings, updateSetting } from '@ui/api/settings';
import { Card } from '@ui/components/ui/card';
import { Input } from '@ui/components/ui/input';
import { Button } from '@ui/components/ui/button';
import { inputValue, type InputEvent } from '@ui/utils/events';

const settingDescriptions: Record<string, string> = {
  circuit_breaker_threshold: 'Failures before circuit opens',
  circuit_breaker_cooldown: 'Cooldown period (seconds)',
  circuit_breaker_max_cooldown: 'Max cooldown with backoff (seconds)',
  relay_log_keep_period: 'Log retention (days)',
  proxy_url: 'System-wide proxy URL',
};

export function SettingsPage() {
  const { data, loading, refetch } = useApi(getSettings);
  const toast = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const handleSave = async (key: string) => {
    const value = edits[key];
    if (value === undefined) return;
    setSavingKey(key);
    try {
      await updateSetting(key, value);
      toast.success(`${key} updated`);
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) return <p class="text-slate-400">Loading...</p>;

  return (
    <Card title="System Settings">
      <div class="space-y-4">
        {(data || []).map((s) => (
          <div key={s.key} class="flex items-end gap-3">
            <div class="flex-1">
              <Input
                label={s.key}
                value={edits[s.key] ?? s.value}
                onInput={(e: InputEvent) => setEdits({ ...edits, [s.key]: inputValue(e) })}
              />
              {settingDescriptions[s.key] && (
                <p class="text-xs text-slate-500 mt-1">{settingDescriptions[s.key]}</p>
              )}
            </div>
            {edits[s.key] !== undefined && edits[s.key] !== s.value && (
              <Button size="sm" onClick={() => handleSave(s.key)} loading={savingKey === s.key}>
                Save
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
