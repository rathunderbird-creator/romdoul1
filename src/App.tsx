import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { StoreProvider, useStore } from './context/StoreContext';
import Dashboard from './pages/DashboardPage';

import Inventory from './pages/Inventory';
import Settings from './pages/Settings';
import Orders from './pages/Orders';
import PaymentTracking from './pages/PaymentTracking';
import DeliveryTracking from './pages/DeliveryTracking';
import UserManagement from './pages/UserManagement';
import Login from './pages/Login';

import { ToastProvider } from './context/ToastContext';
import { HeaderProvider } from './context/HeaderContext';
import { ThemeProvider } from './context/ThemeContext';

import ProtectedRoute from './components/ProtectedRoute';

const ProtectedApp = () => {
  const { currentUser } = useStore();

  if (!currentUser) {
    return <Login />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ProtectedRoute requiredPermission="view_dashboard"><Dashboard /></ProtectedRoute>} />
        {/* <Route path="/pos" element={<ProtectedRoute requiredPermission="process_sales"><POS /></ProtectedRoute>} /> */}
        <Route path="/inventory" element={<ProtectedRoute requiredPermission="manage_inventory"><Inventory /></ProtectedRoute>} />
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
