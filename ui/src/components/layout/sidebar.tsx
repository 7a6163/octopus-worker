import { useAuth } from '@ui/hooks/use-auth';

interface NavItem {
  path: string;
  label: string;
  icon: string;
}

const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: '&#9634;' },
  { path: '/channels', label: 'Channels', icon: '&#8644;' },
  { path: '/groups', label: 'Groups', icon: '&#9881;' },
  { path: '/apikeys', label: 'API Keys', icon: '&#128273;' },
  { path: '/users', label: 'Users', icon: '&#128100;' },
  { path: '/settings', label: 'Settings', icon: '&#9881;' },
  { path: '/model-prices', label: 'Model Prices', icon: '&#36;' },
];

interface SidebarProps {
  currentPath: string;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ currentPath, open, onClose }: SidebarProps) {
  const { logout } = useAuth();

  return (
    <>
      {open && <div class="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} />}
      <aside
        class={`fixed top-0 left-0 z-40 h-full w-64 bg-slate-900 border-r border-slate-700 transition-transform
          lg:translate-x-0 lg:static lg:z-auto
          ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div class="flex items-center gap-3 border-b border-slate-700 px-5 py-4">
          <span class="text-xl">&#128025;</span>
          <span class="font-bold text-lg text-slate-100">Octopus</span>
        </div>

        <nav class="flex flex-col gap-1 p-3">
          {navItems.map((item) => {
            const active = currentPath === item.path || (item.path !== '/' && currentPath.startsWith(item.path));
            return (
              <a
                key={item.path}
                href={item.path}
                onClick={onClose}
                class={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors
                  ${active ? 'bg-blue-600/20 text-blue-300' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
              >
                <span dangerouslySetInnerHTML={{ __html: item.icon }} />
                {item.label}
              </a>
            );
          })}
        </nav>

        <div class="absolute bottom-0 left-0 right-0 border-t border-slate-700 p-3">
          <button
            onClick={logout}
            class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-400
              hover:bg-slate-800 hover:text-red-400 transition-colors cursor-pointer"
          >
            <span>&#x2190;</span>
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}
