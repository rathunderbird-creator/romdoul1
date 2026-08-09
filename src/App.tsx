import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { StoreProvider, useStore } from './context/StoreContext';
import Login from './pages/Login';

// Lazy Load Pages
const Dashboard = lazy(() => import('./pages/DashboardPage'));
const TodoPage = lazy(() => import('./pages/TodoPage'));
const Inventory = lazy(() => import('./pages/Inventory'));
const IncomeExpense = lazy(() => import('./pages/IncomeExpense'));
const SettingsLayout = lazy(() => import('./pages/settings/SettingsLayout'));
const StoreProfileSettings = lazy(() => import('./pages/settings/StoreProfileSettings'));
const GeneralSettings = lazy(() => import('./pages/settings/GeneralSettings'));
const TelegramSettings = lazy(() => import('./pages/settings/TelegramSettings'));
const SecuritySettings = lazy(() => import('./pages/settings/SecuritySettings'));
const DatabaseSettings = lazy(() => import('./pages/settings/DatabaseSettings'));

const Orders = lazy(() => import('./pages/Orders'));
const DeletedOrders = lazy(() => import('./pages/DeletedOrders'));
const Scammers = lazy(() => import('./pages/Scammers'));
const PaymentTracking = lazy(() => import('./pages/PaymentTracking'));
const DeliveryTracking = lazy(() => import('./pages/DeliveryTracking'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const OrderDetailPage = lazy(() => import('./pages/OrderDetailPage'));
const ShippingPoint = lazy(() => import('./pages/ShippingPoint'));
const AttendancePage = lazy(() => import('./pages/hr/AttendancePage'));
const CategoriesPage = lazy(() => import('./pages/inventory/CategoriesPage'));
const WarehousesPage = lazy(() => import('./pages/inventory/WarehousesPage'));
const StockMovementsPage = lazy(() => import('./pages/inventory/StockMovementsPage'));
const Revenue = lazy(() => import('./pages/Revenue'));
const IncomePrediction = lazy(() => import('./pages/IncomePrediction'));

const ReportsLayout = lazy(() => import('./pages/reports/ReportsLayout'));
const SalesSummary = lazy(() => import('./pages/reports/SalesSummary'));
const InventoryAnalytics = lazy(() => import('./pages/reports/InventoryAnalytics'));
const FinancialReport = lazy(() => import('./pages/reports/FinancialReport'));
const StaffPerformance = lazy(() => import('./pages/reports/StaffPerformance'));
const TopProducts = lazy(() => import('./pages/reports/TopProducts'));
const ShippingReport = lazy(() => import('./pages/reports/ShippingReport'));
const PurchaseCostReport = lazy(() => import('./pages/reports/PurchaseCostReport'));

// ERP Pages
const EmployeesPage = lazy(() => import('./pages/hr/EmployeesPage'));
const LeavesPage = lazy(() => import('./pages/hr/LeavesPage'));
const PayrollPage = lazy(() => import('./pages/hr/PayrollPage'));
const LeadsPage = lazy(() => import('./pages/crm/LeadsPage'));
const InteractionsPage = lazy(() => import('./pages/crm/InteractionsPage'));
const QuotationsPage = lazy(() => import('./pages/crm/QuotationsPage'));
const SuppliersPage = lazy(() => import('./pages/procurement/SuppliersPage'));
const SupplierDetailsPage = lazy(() => import('./pages/procurement/SupplierDetailsPage'));
const PurchaseOrdersPage = lazy(() => import('./pages/procurement/PurchaseOrdersPage'));
const ReceivingPage = lazy(() => import('./pages/procurement/ReceivingPage'));
const ChartOfAccountsPage = lazy(() => import('./pages/accounting/ChartOfAccountsPage'));
const JournalEntriesPage = lazy(() => import('./pages/accounting/JournalEntriesPage'));
const PaymentsPage = lazy(() => import('./pages/accounting/PaymentsPage'));

import { ToastProvider } from './context/ToastContext';
import { HeaderProvider } from './context/HeaderContext';
import { ThemeProvider } from './context/ThemeContext';
import { ActivityLogProvider } from './context/ActivityLogContext';
import { LanguageProvider } from './context/LanguageContext';

import ProtectedRoute from './components/ProtectedRoute';

const LoadingFallback = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
    <div className="loader">Loading...</div>
  </div>
);

const ProtectedApp = () => {
  const { currentUser, isLoading, refreshData } = useStore();

  useEffect(() => {
    if (currentUser) {
      // Auto refresh every 20 minutes
      const interval = setInterval(() => {
        refreshData(true).catch(console.error);
      }, 20 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [currentUser, refreshData]);

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
          <Route path="/todo" element={<ProtectedRoute requiredPermission="view_dashboard"><TodoPage /></ProtectedRoute>} />
          {/* <Route path="/pos" element={<ProtectedRoute requiredPermission="process_sales"><POS /></ProtectedRoute>} /> */}
          <Route path="/inventory" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_inventory_stock']}><Inventory /></ProtectedRoute>} />
          <Route path="/inventory/categories" element={<ProtectedRoute requiredPermission="manage_inventory"><CategoriesPage /></ProtectedRoute>} />
          <Route path="/inventory/warehouses" element={<ProtectedRoute requiredPermission="manage_inventory"><WarehousesPage /></ProtectedRoute>} />
          <Route path="/inventory/stock-movements" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_inventory_stock']}><StockMovementsPage /></ProtectedRoute>} />
          <Route path="/income-expense" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_reports', 'view_inventory_stock']}><IncomeExpense /></ProtectedRoute>} />
          <Route path="/income-expense/income" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_reports', 'view_inventory_stock']}><IncomeExpense /></ProtectedRoute>} />
          <Route path="/income-expense/expense" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_reports', 'view_inventory_stock']}><IncomeExpense /></ProtectedRoute>} />
          <Route path="/income-expense/revenue" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_reports', 'view_inventory_stock']}><Revenue /></ProtectedRoute>} />
          <Route path="/income-expense/prediction" element={<ProtectedRoute requiredPermissions={['manage_inventory', 'view_reports', 'view_inventory_stock']}><IncomePrediction /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute requiredPermissions={['manage_orders', 'create_orders', 'view_orders']}><Orders /></ProtectedRoute>} />
          <Route path="/orders/shipping" element={<ProtectedRoute requiredPermission="manage_orders"><DeliveryTracking /></ProtectedRoute>} />
          <Route path="/orders/deleted" element={<ProtectedRoute requiredPermission="manage_orders"><DeletedOrders /></ProtectedRoute>} />
          <Route path="/orders/scammers" element={<ProtectedRoute requiredPermission="manage_orders"><Scammers /></ProtectedRoute>} />
          <Route path="/orders/:id" element={<ProtectedRoute requiredPermissions={['manage_orders', 'create_orders', 'view_orders']}><OrderDetailPage /></ProtectedRoute>} />

          {/* These pages seem to be work in progress or not fully guarded in Sidebar yet, 
              but better protect them or hide them if not used. 
              For now, I'll protect them with 'manage_orders' as they relate to order tracking. */}
          <Route path="/payment-tracking" element={<ProtectedRoute requiredPermission="manage_orders"><PaymentTracking /></ProtectedRoute>} />

          <Route path="/shipping-point" element={<ProtectedRoute requiredPermission="view_dashboard"><ShippingPoint /></ProtectedRoute>} />
          {/* HR & Payroll */}
          <Route path="/hr/attendance" element={<ProtectedRoute requiredPermission="manage_attendance"><AttendancePage /></ProtectedRoute>} />

          <Route path="/reports" element={<ProtectedRoute requiredPermission="view_reports"><ReportsLayout /></ProtectedRoute>}>
            <Route index element={<Navigate to="sales" replace />} />
            <Route path="sales" element={<SalesSummary />} />
            <Route path="products" element={<TopProducts />} />
            <Route path="inventory" element={<InventoryAnalytics />} />
            <Route path="financials" element={<FinancialReport />} />
            <Route path="staff" element={<StaffPerformance />} />
            <Route path="shipping" element={<ShippingReport />} />
            <Route path="purchase-cost" element={<PurchaseCostReport />} />
          </Route>

          <Route path="/users" element={<ProtectedRoute requiredPermission="manage_users"><UserManagement /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute requiredPermission="manage_settings"><SettingsLayout /></ProtectedRoute>}>
            <Route index element={<Navigate to="store-profile" replace />} />
            <Route path="store-profile" element={<StoreProfileSettings />} />
            <Route path="general" element={<GeneralSettings />} />
            <Route path="telegram" element={<TelegramSettings />} />
            <Route path="security" element={<SecuritySettings />} />
            <Route path="database" element={<DatabaseSettings />} />
          </Route>

          {/* ERP Routes */}
          <Route path="/hr/employees" element={<ProtectedRoute requiredPermission="manage_hr"><EmployeesPage /></ProtectedRoute>} />
          <Route path="/hr/leaves" element={<ProtectedRoute requiredPermission="manage_hr"><LeavesPage /></ProtectedRoute>} />
          <Route path="/hr/payroll" element={<ProtectedRoute requiredPermission="manage_hr"><PayrollPage /></ProtectedRoute>} />
          
          <Route path="/crm/leads" element={<ProtectedRoute requiredPermission="manage_crm"><LeadsPage /></ProtectedRoute>} />
          <Route path="/crm/interactions" element={<ProtectedRoute requiredPermission="manage_crm"><InteractionsPage /></ProtectedRoute>} />
          <Route path="/crm/quotations" element={<ProtectedRoute requiredPermission="manage_crm"><QuotationsPage /></ProtectedRoute>} />

          <Route path="/procurement/suppliers" element={<ProtectedRoute requiredPermission="manage_procurement"><SuppliersPage /></ProtectedRoute>} />
          <Route path="/procurement/suppliers/:id" element={<ProtectedRoute requiredPermission="manage_procurement"><SupplierDetailsPage /></ProtectedRoute>} />
          <Route path="/procurement/purchase-orders" element={<ProtectedRoute requiredPermission="manage_procurement"><PurchaseOrdersPage /></ProtectedRoute>} />
          <Route path="/procurement/receiving" element={<ProtectedRoute requiredPermission="manage_procurement"><ReceivingPage /></ProtectedRoute>} />

          <Route path="/accounting/chart-of-accounts" element={<ProtectedRoute requiredPermission="manage_accounting"><ChartOfAccountsPage /></ProtectedRoute>} />
          <Route path="/accounting/journal-entries" element={<ProtectedRoute requiredPermission="manage_accounting"><JournalEntriesPage /></ProtectedRoute>} />
          <Route path="/accounting/payments" element={<ProtectedRoute requiredPermission="manage_accounting"><PaymentsPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
};

function App() {
  return (
    <LanguageProvider>
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
    </LanguageProvider>
  );
}

export default App;
