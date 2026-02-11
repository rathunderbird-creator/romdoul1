import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { StoreProvider, useStore } from './context/StoreContext';
import Login from './pages/Login';

// Lazy Load Pages
const Dashboard = lazy(() => import('./pages/DashboardPage'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Settings = lazy(() => import('./pages/Settings'));
const Orders = lazy(() => import('./pages/Orders'));
const PaymentTracking = lazy(() => import('./pages/PaymentTracking'));
const DeliveryTracking = lazy(() => import('./pages/DeliveryTracking'));
const UserManagement = lazy(() => import('./pages/UserManagement'));

import { ToastProvider } from './context/ToastContext';
import { HeaderProvider } from './context/HeaderContext';
import { ThemeProvider } from './context/ThemeContext';

import ProtectedRoute from './components/ProtectedRoute';

const LoadingFallback = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <div className="loader">Loading...</div>
  </div>
);

const ProtectedApp = () => {
  const { currentUser, isLoading } = useStore();

  if (isLoading) {
    return <LoadingFallback />;
  }

  if (!currentUser) {
    return <Login />;
  }

  return (
    <Layout>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          <Route path="/" element={<ProtectedRoute requiredPermission="view_dashboard"><Dashboard /></ProtectedRoute>} />
          {/* <Route path="/pos" element={<ProtectedRoute requiredPermission="process_sales"><POS /></ProtectedRoute>} /> */}
          <Route path="/inventory" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_inventory_stock']}><Inventory /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute requiredPermissions={['manage_orders', 'create_orders', 'view_orders']}><Orders /></ProtectedRoute>} />

          {/* These pages seem to be work in progress or not fully guarded in Sidebar yet, 
              but better protect them or hide them if not used. 
              For now, I'll protect them with 'manage_orders' as they relate to order tracking. */}
          <Route path="/payment-tracking" element={<ProtectedRoute requiredPermission="manage_orders"><PaymentTracking /></ProtectedRoute>} />
          <Route path="/delivery-tracking" element={<ProtectedRoute requiredPermission="manage_orders"><DeliveryTracking /></ProtectedRoute>} />

          <Route path="/users" element={<ProtectedRoute requiredPermission="manage_users"><UserManagement /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute requiredPermission="manage_settings"><Settings /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
};

function App() {
  return (
    <ThemeProvider>
      <StoreProvider>
        <ToastProvider>
          <HeaderProvider>
            <Router>
              <ProtectedApp />
            </Router>
          </HeaderProvider>
        </ToastProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}

export default App;
