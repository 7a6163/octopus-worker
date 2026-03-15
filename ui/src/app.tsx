import Router, { Route, route } from 'preact-router';
import { useEffect } from 'preact/hooks';
import { ComponentChildren } from 'preact';
import { AuthContext, useAuth, useAuthProvider } from '@ui/hooks/use-auth';
import { ToastContext, useToastProvider } from '@ui/hooks/use-toast';
import { ToastContainer } from '@ui/components/ui/toast';
import { PageLayout } from '@ui/components/layout/page-layout';
import { LoginPage } from '@ui/pages/login';
import { DashboardPage } from '@ui/pages/dashboard';
import { ChannelListPage } from '@ui/pages/channels/list';
import { GroupListPage } from '@ui/pages/groups/list';
import { ApiKeyListPage } from '@ui/pages/apikeys/list';
import { UserListPage } from '@ui/pages/users/list';
import { SettingsPage } from '@ui/pages/settings';
import { ModelPricesPage } from '@ui/pages/model-prices';

interface AuthGuardProps {
  children: ComponentChildren;
  path?: string;
  default?: boolean;
}

function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      route('/login', true);
    }
  }, [user, loading]);

  if (loading) {
    return <div class="flex min-h-screen items-center justify-center text-slate-400">Loading...</div>;
  }

  if (!user) return null;

  return <>{children}</>;
}

interface ProtectedPageProps {
  title: string;
  path: string;
  children: ComponentChildren;
}

function ProtectedPage({ title, path, children }: ProtectedPageProps) {
  return (
    <AuthGuard path={path}>
      <PageLayout title={title} currentPath={path}>
        {children}
      </PageLayout>
    </AuthGuard>
  );
}

export function App() {
  const auth = useAuthProvider();
  const toastState = useToastProvider();

  return (
    <AuthContext.Provider value={auth}>
      <ToastContext.Provider value={toastState}>
        <Router>
          <Route path="/login" component={LoginPage} />
          <ProtectedPage path="/" title="Dashboard">
            <DashboardPage />
          </ProtectedPage>
          <ProtectedPage path="/channels" title="Channels">
            <ChannelListPage />
          </ProtectedPage>
          <ProtectedPage path="/groups" title="Groups">
            <GroupListPage />
          </ProtectedPage>
          <ProtectedPage path="/apikeys" title="API Keys">
            <ApiKeyListPage />
          </ProtectedPage>
          <ProtectedPage path="/users" title="Users">
            <UserListPage />
          </ProtectedPage>
          <ProtectedPage path="/settings" title="Settings">
            <SettingsPage />
          </ProtectedPage>
          <ProtectedPage path="/model-prices" title="Model Prices">
            <ModelPricesPage />
          </ProtectedPage>
        </Router>
        <ToastContainer toasts={toastState.toasts} onRemove={toastState.remove} />
      </ToastContext.Provider>
    </AuthContext.Provider>
  );
}
