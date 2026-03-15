import { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Header } from './header';
import { Sidebar } from './sidebar';

interface PageLayoutProps {
  title: string;
  currentPath: string;
  children: ComponentChildren;
}

export function PageLayout({ title, currentPath, children }: PageLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div class="flex h-screen overflow-hidden">
      <Sidebar
        currentPath={currentPath}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div class="flex flex-1 flex-col overflow-hidden">
        <Header title={title} onMenuClick={() => setSidebarOpen(true)} />
        <main class="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
