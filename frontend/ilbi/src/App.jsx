import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthProvider.jsx';
import { useAuth } from './hooks/useAuth';
import { TenantProvider } from './context/TenantContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { ThemeProvider } from './context/ThemeContext';
import AppLoadingScreen, { AppLoadingProvider } from './components/common/AppLoadingScreen';
import SessionRecovery from './components/auth/SessionRecovery';
import DesktopUpdateNotice from './components/sync/DesktopUpdateNotice';
import DesktopSessionGuard from './components/sync/DesktopSessionGuard';
const Layout = lazy(() => import('./components/layout/Layout'));
const HelpLauncher = lazy(() => import('./components/support/HelpLauncher'));
const Landing = lazy(() => import('./pages/Landing'));
const Downloads = lazy(() => import('./pages/Downloads'));
const DesktopGuide = lazy(() => import('./pages/DesktopGuide'));
const Support = lazy(() => import('./pages/Support'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const POS = lazy(() => import('./pages/POS'));
const Catalog = lazy(() => import('./pages/Catalog'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Sales = lazy(() => import('./pages/Sales'));
const Debts = lazy(() => import('./pages/Debts'));
const B2BTransactions = lazy(() => import('./pages/B2BTransactions'));
const Shifts = lazy(() => import('./pages/Shifts'));
const Audit = lazy(() => import('./pages/Audit'));
const History = lazy(() => import('./pages/History'));
const Tenants = lazy(() => import('./pages/Tenants'));
const SellerProfileReviews = lazy(() => import('./pages/SellerProfileReviews'));
const MyTenants = lazy(() => import('./pages/MyTenants'));
const Employees = lazy(() => import('./pages/Employees'));
const PlatformAccounts = lazy(() => import('./pages/PlatformAccounts'));
const Services = lazy(() => import('./pages/Services'));
const Profile = lazy(() => import('./pages/Profile'));
const SetupAccount = lazy(() => import('./pages/SetupAccount'));
const AcceptTerms = lazy(() => import('./pages/AcceptTerms'));
const Documentation = lazy(() => import('./pages/Documentation'));
const PublicReceiptView = lazy(() => import('./pages/PublicReceiptView'));

function ProtectedRoute({ children }) {
  const { isAuthenticated, user, loading, sessionError } = useAuth();
  if (loading) return <AppLoadingScreen message="Xavfsiz sessiya tekshirilmoqda..." />;
  if (sessionError) return <SessionRecovery />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (user && user.terms_accepted === false) {
    return <Navigate to="/accept-terms" replace />;
  }
  return children;
}

function RoleProtectedRoute({ children, allowedRoles, allowedPermission }) {
  const { role, isAuthenticated, user, loading, sessionError } = useAuth();
  if (loading) return <AppLoadingScreen message="Xavfsiz sessiya tekshirilmoqda..." />;
  if (sessionError) return <SessionRecovery />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (user && user.terms_accepted === false) {
    return <Navigate to="/accept-terms" replace />;
  }
  if (!allowedRoles.includes(role) && !(allowedPermission && (user?.permissions || []).includes(allowedPermission))) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function SupportRoute() {
  const { isAuthenticated, loading, sessionError } = useAuth();
  if (loading) return <AppLoadingScreen message="Xavfsiz sessiya tekshirilmoqda..." />;
  if (sessionError) return <SessionRecovery />;
  if (isAuthenticated) {
    return (
      <ProtectedRoute>
        <Layout>
          <Support />
        </Layout>
      </ProtectedRoute>
    );
  }
  return <Support />;
}

function RoutePresentation() {
  const { pathname } = useLocation();
  useEffect(() => {
    const isLanding = pathname === '/';
    document.title = isLanding ? 'ILBI — Har bir savdo. Bir butun manzara.' : pathname === '/download' ? 'ILBI — Yuklab olish' : pathname === '/desktop-guide' ? 'ILBI — Ilovani sozlash' : 'ILBI — Savdo va boshqaruv tizimi';
    document.querySelector('meta[name="robots"]')?.setAttribute('content', isLanding || pathname === '/download' ? 'index, follow' : 'noindex, nofollow');
  }, [pathname]);
  if (pathname === '/' || pathname === '/desktop-guide') return null;
  return <Suspense fallback={null}><HelpLauncher /></Suspense>;
}

function SessionUI({ children }) {
  const { sessionId, user, isAuthenticated } = useAuth();
  // Toasts and open confirmations can contain private names, amounts or drafts.
  return <ToastProvider key={`${sessionId}:${user?.id || 'guest'}`}><ConfirmProvider><DesktopUpdateNotice accountId={isAuthenticated ? user?.id : null} sessionId={sessionId} />{children}</ConfirmProvider></ToastProvider>;
}

export default function App() {
  return (
    <BrowserRouter useTransitions={false}>
      <ThemeProvider>
        <AppLoadingProvider>
        <AuthProvider>
          <DesktopSessionGuard />
          <TenantProvider>
            <SessionUI>
                <Suspense fallback={<AppLoadingScreen message="Sahifa yuklanmoqda..." />}>
                <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/download" element={<Downloads />} />
                <Route path="/desktop-guide" element={<DesktopGuide />} />
                <Route path="/login" element={<Login />} />
                <Route path="/support" element={<SupportRoute />} />
                <Route path="/setup-account" element={<SetupAccount />} />
                <Route path="/reset-password" element={<SetupAccount />} />
                <Route path="/accept-terms" element={<AcceptTerms />} />
                <Route path="/r/:token" element={<PublicReceiptView />} />
                <Route path="/receipt/:token" element={<PublicReceiptView />} />

                <Route
                  element={
                    <ProtectedRoute>
                      <Layout />
                    </ProtectedRoute>
                  }
                >
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="accounts" element={<RoleProtectedRoute allowedRoles={['platform_admin']}><PlatformAccounts /></RoleProtectedRoute>} />
                  <Route path="pos" element={<POS />} />
                  <Route path="catalog" element={<Catalog />} />
                  <Route path="inventory" element={<Inventory />} />
                  <Route path="sales" element={<Sales />} />
                  <Route path="debts" element={<Debts />} />
                  <Route path="b2b" element={<B2BTransactions />} />
                  <Route path="shifts" element={<Shifts />} />
                  <Route path="history" element={<RoleProtectedRoute allowedRoles={['owner', 'platform_admin']}><History /></RoleProtectedRoute>} />
                  <Route
                    path="tenants"
                    element={
                      <RoleProtectedRoute allowedRoles={['platform_admin']}>
                        <Tenants />
                      </RoleProtectedRoute>
                    }
                  />
                  <Route
                    path="seller-profiles/review"
                    element={
                      <RoleProtectedRoute allowedRoles={['platform_admin']}>
                        <SellerProfileReviews />
                      </RoleProtectedRoute>
                    }
                  />
                  <Route
                    path="my-tenants"
                    element={
                      <RoleProtectedRoute allowedRoles={['owner']}>
                        <MyTenants />
                      </RoleProtectedRoute>
                    }
                  />
                  <Route
                    path="employees"
                    element={
                      <RoleProtectedRoute allowedRoles={['owner', 'platform_admin']}>
                        <Employees />
                      </RoleProtectedRoute>
                    }
                  />
                  <Route
                    path="services"
                    element={
                      <RoleProtectedRoute allowedRoles={['owner', 'platform_admin']} allowedPermission="tenants.manage_settings">
                        <Services />
                      </RoleProtectedRoute>
                    }
                  />
                  <Route
                    path="audit"
                    element={
                      <RoleProtectedRoute allowedRoles={['owner', 'platform_admin']}>
                        <Audit />
                      </RoleProtectedRoute>
                    }
                  />
                  <Route path="profile" element={<Profile />} />
                  <Route path="docs" element={<Documentation />} />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
                </Suspense>
                <RoutePresentation />
          </SessionUI>
        </TenantProvider>
        </AuthProvider>
        </AppLoadingProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

