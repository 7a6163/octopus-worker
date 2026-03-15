import { useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '@ui/hooks/use-auth';
import { Button } from '@ui/components/ui/button';
import { Input } from '@ui/components/ui/input';
import { inputValue, type InputEvent } from '@ui/utils/events';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      route('/');
    } catch (err) {
      setError((err as Error).message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="flex min-h-screen items-center justify-center px-4">
      <div class="w-full max-w-sm">
        <div class="mb-8 text-center">
          <span class="text-4xl">&#128025;</span>
          <h1 class="mt-3 text-2xl font-bold text-slate-100">Octopus Workers</h1>
          <p class="mt-1 text-sm text-slate-400">Sign in to admin panel</p>
        </div>

        <form onSubmit={handleSubmit} class="rounded-xl border border-slate-700 bg-slate-800/50 p-6 space-y-4">
          {error && (
            <div class="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
          <Input
            label="Username"
            value={username}
            onInput={(e: InputEvent) => setUsername(inputValue(e))}
            placeholder="admin"
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onInput={(e: InputEvent) => setPassword(inputValue(e))}
            placeholder="••••••"
            required
          />
          <Button type="submit" loading={loading} class="w-full">
            Sign In
          </Button>
        </form>
      </div>
    </div>
  );
}
