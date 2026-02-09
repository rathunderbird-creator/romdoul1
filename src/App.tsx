import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import { StoreProvider } from './context/StoreContext';
import Dashboard from './pages/DashboardPage';
import POS from './pages/POS';
import Inventory from './pages/Inventory';
import Settings from './pages/Settings';
import Orders from './pages/Orders';
import PaymentTracking from './pages/PaymentTracking';
import DeliveryTracking from './pages/DeliveryTracking';
import Report from './pages/Report';

import { ToastProvider } from './context/ToastContext';
import { HeaderProvider } from './context/HeaderContext';

import { ThemeProvider } from './context/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <StoreProvider>
        <ToastProvider>
          <HeaderProvider>
            <Router>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/pos" element={<POS />} />
                  <Route path="/inventory" element={<Inventory />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/payment-tracking" element={<PaymentTracking />} />
                  <Route path="/delivery-tracking" element={<DeliveryTracking />} />
                  <Route path="/report" element={<Report />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Layout>
            </Router>
          </HeaderProvider>
        </ToastProvider>
      </StoreProvider>
    </ThemeProvider>
  );
}

export default App;
