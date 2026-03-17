import { useAuth } from '@ui/hooks/use-auth';

interface HeaderProps {
  title: string;
  onMenuClick: () => void;
}

export function Header({ title, onMenuClick }: HeaderProps) {
  const { user } = useAuth();

  return (
    <header class="flex items-center justify-between border-b border-slate-700 bg-slate-900/50 px-6 py-4">
      <div class="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          aria-label="Open menu"
          class="text-slate-400 hover:text-slate-200 lg:hidden cursor-pointer"
        >
          &#9776;
        </button>
        <h1 class="text-lg font-semibold text-slate-100">{title}</h1>
      </div>
      {user && (
        <div class="flex items-center gap-2 text-sm text-slate-400">
          <span>&#128100;</span>
          <span>{user.username}</span>
        </div>
      )}
    </header>
  );
}
