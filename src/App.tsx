import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { StoreProvider, useStore } from './context/StoreContext';
import Login from './pages/Login';

// Lazy Load Pages
const Dashboard = lazy(() => import('./pages/DashboardPage'));
const Inventory = lazy(() => import('./pages/Inventory'));
const IncomeExpense = lazy(() => import('./pages/IncomeExpense'));
const Settings = lazy(() => import('./pages/Settings'));
const Orders = lazy(() => import('./pages/Orders'));
const PaymentTracking = lazy(() => import('./pages/PaymentTracking'));
const DeliveryTracking = lazy(() => import('./pages/DeliveryTracking'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage'));
const MobileOperators = lazy(() => import('./pages/MobileOperators'));
const ShippingPoint = lazy(() => import('./pages/ShippingPoint'));
const Attendance = lazy(() => import('./pages/Attendance'));
const ReturnsRestocks = lazy(() => import('./pages/ReturnsRestocks'));
const StockIn = lazy(() => import('./pages/StockIn'));
const StockOut = lazy(() => import('./pages/StockOut'));
const Revenue = lazy(() => import('./pages/Revenue'));

const ReportsLayout = lazy(() => import('./pages/reports/ReportsLayout'));
const SalesSummary = lazy(() => import('./pages/reports/SalesSummary'));
const InventoryAnalytics = lazy(() => import('./pages/reports/InventoryAnalytics'));
const FinancialReport = lazy(() => import('./pages/reports/FinancialReport'));
const StaffPerformance = lazy(() => import('./pages/reports/StaffPerformance'));
const TopProducts = lazy(() => import('./pages/reports/TopProducts'));
const ShippingReport = lazy(() => import('./pages/reports/ShippingReport'));

import { ToastProvider } from './context/ToastContext';
import { HeaderProvider } from './context/HeaderContext';
import { ThemeProvider } from './context/ThemeContext';
import { ActivityLogProvider } from './context/ActivityLogContext';

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
          <Route path="/inventory/stock-in" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_inventory_stock']}><StockIn /></ProtectedRoute>} />
          <Route path="/inventory/stock-out" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_inventory_stock']}><StockOut /></ProtectedRoute>} />
          <Route path="/inventory/returns" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_inventory_stock']}><ReturnsRestocks /></ProtectedRoute>} />
          <Route path="/income-expense" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_reports', 'view_inventory_stock']}><IncomeExpense /></ProtectedRoute>} />
          <Route path="/income-expense/income" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_reports', 'view_inventory_stock']}><IncomeExpense /></ProtectedRoute>} />
          <Route path="/income-expense/expense" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_reports', 'view_inventory_stock']}><IncomeExpense /></ProtectedRoute>} />
          <Route path="/income-expense/revenue" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_reports', 'view_inventory_stock']}><Revenue /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute requiredPermissions={['manage_orders', 'create_orders', 'view_orders']}><Orders /></ProtectedRoute>} />
          <Route path="/orders/:id" element={<ProtectedRoute requiredPermissions={['manage_orders', 'create_orders', 'view_orders']}><OrderDetailPage /></ProtectedRoute>} />

          {/* These pages seem to be work in progress or not fully guarded in Sidebar yet, 
              but better protect them or hide them if not used. 
              For now, I'll protect them with 'manage_orders' as they relate to order tracking. */}
          <Route path="/payment-tracking" element={<ProtectedRoute requiredPermission="manage_orders"><PaymentTracking /></ProtectedRoute>} />
          <Route path="/delivery-tracking" element={<ProtectedRoute requiredPermission="manage_orders"><DeliveryTracking /></ProtectedRoute>} />

          <Route path="/mobile-operators" element={<ProtectedRoute requiredPermission="view_dashboard"><MobileOperators /></ProtectedRoute>} />
          <Route path="/shipping-point" element={<ProtectedRoute requiredPermission="view_dashboard"><ShippingPoint /></ProtectedRoute>} />
          <Route path="/attendance" element={<ProtectedRoute requiredPermissions={['manage_attendance']}><Attendance /></ProtectedRoute>} />

          <Route path="/reports" element={<ProtectedRoute requiredPermission="view_reports"><ReportsLayout /></ProtectedRoute>}>
            <Route index element={<Navigate to="sales" replace />} />
            <Route path="sales" element={<SalesSummary />} />
            <Route path="products" element={<TopProducts />} />
            <Route path="inventory" element={<InventoryAnalytics />} />
            <Route path="financials" element={<FinancialReport />} />
            <Route path="staff" element={<StaffPerformance />} />
            <Route path="shipping" element={<ShippingReport />} />
          </Route>

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
            <ActivityLogProvider>
              <Router>
                <ProtectedApp />
              </Router>
            </ActivityLogProvider>
          </HeaderProvider>
        </ToastProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}

export default App;
