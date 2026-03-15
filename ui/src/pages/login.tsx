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
    <div class="relative flex min-h-screen items-center justify-center px-4 overflow-hidden">
      {/* Background gradient orbs */}
      <div class="absolute -top-40 -left-40 h-80 w-80 rounded-full bg-blue-600/20 blur-[120px]" />
      <div class="absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-purple-600/20 blur-[120px]" />
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-60 w-60 rounded-full bg-cyan-600/10 blur-[100px]" />

      <div class="relative z-10 w-full max-w-sm">
        {/* Logo & Title */}
        <div class="mb-10 text-center">
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/25">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
            </svg>
          </div>
          <h1 class="text-2xl font-bold tracking-tight text-white">Octopus Workers</h1>
          <p class="mt-2 text-sm text-slate-400">LLM API Aggregation & Load Balancing</p>
        </div>

        {/* Login Card */}
        <div class="rounded-2xl border border-slate-700/50 bg-slate-800/80 backdrop-blur-xl p-8 shadow-2xl shadow-black/20">
          <form onSubmit={handleSubmit} class="space-y-5">
            {error && (
              <div class="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {error}
              </div>
            )}

            <Input
              label="Username"
              value={username}
              onInput={(e: InputEvent) => setUsername(inputValue(e))}
              placeholder="Enter username"
              required
              autocomplete="username"
            />

            <Input
              label="Password"
              type="password"
              value={password}
              onInput={(e: InputEvent) => setPassword(inputValue(e))}
              placeholder="Enter password"
              required
              autocomplete="current-password"
            />

            <Button type="submit" loading={loading} class="w-full py-2.5 text-base">
              Sign In
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p class="mt-6 text-center text-xs text-slate-500">
          Powered by Cloudflare Workers
        </p>
      </div>
    </div>
  );
}
