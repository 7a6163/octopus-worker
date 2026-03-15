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
          <div class="mx-auto mb-4 flex h-20 w-20 items-center justify-center">
            <svg width="80" height="80" viewBox="-7.5 0 271 271">
              <path d="M17.1555807,205.218876 C37.5752036,192.098061 61.4596304,169.548436 52.3716202,143.136406 C47.4300146,128.70919 40.5572069,116.326776 39.6484059,100.735159 C38.8305965,87.5311278 40.7647982,74.3011882 45.3284123,61.8839151 C63.7032329,12.8654601 118.004094,-10.337366 167.050949,4.37385054 C212.491,18.0058658 243.731035,70.7731251 224.930214,116.752777 C214.053002,143.306807 209.196596,163.86843 233.535424,184.430053 C240.095831,190.110059 256.056649,198.402868 256,208.34288 C256,221.350094 230.43982,205.502876 227.599817,203.316074 C230.837421,208.99608 262.986257,242.479718 242.538234,244.865321 C223.709013,247.052123 207.066594,220.753693 195.763381,209.478881 C176.76376,190.50766 180.058164,232.482907 179.972963,241.144916 C179.972963,254.833732 170.174952,282.552163 152.822533,264.489743 C138.622517,249.579726 143.904923,225.808899 133.936512,209.223281 C122.775299,191.07566 104.741279,227.370901 100.055274,234.016508 C95.000068,241.428917 69.6388396,277.354957 59.5284282,258.213336 C51.349219,242.678518 64.4132337,218.453291 70.888441,204.253275 C68.5312383,209.365281 51.9172197,216.891289 47.0608142,219.362092 C36.5310162,225.166458 24.5915033,227.920217 12.5831755,227.314101 C-12.9768532,225.468099 6.61916882,211.921284 17.0419805,205.218876 L17.1555807,205.218876 Z" fill="#2F93E0" fill-rule="nonzero"/>
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
