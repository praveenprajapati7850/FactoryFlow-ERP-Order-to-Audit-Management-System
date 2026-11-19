import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LoginScreen } from './components/LoginScreen';
import { Layout, NavKey, canRoleAccessNav } from './components/Layout';
import { OverviewPage } from './pages/OverviewPage';
import { OrdersPage } from './pages/OrdersPage';
import { CustomersPage, ProductsPage } from './pages/CustomersProductsPage';
import { InventoryPage, PurchasesPage } from './pages/InventoryPurchasesPage';
import { BomPage, ProductionPage } from './pages/BomProductionPage';
import { InvoicesPage, PaymentsPage } from './pages/InvoicesPaymentsPage';
import {
  CostingPage,
  ReportsPage,
  AuditTrailPage,
  UsersPage,
  SettingsPage,
} from './pages/CostingReportsAuditPage';

function getDefaultNavForRole(roleCode: string): NavKey {
  if (roleCode === 'SALESMAN') return 'orders';
  if (roleCode === 'PRODUCTION_SUPERVISOR') return 'production';
  if (roleCode === 'AUDITOR') return 'reports';
  return 'overview';
}

const ErpWorkspace: React.FC = () => {
  const { user, initializing } = useAuth();
  const [activeNav, setActiveNav] = useState<NavKey>('overview');

  // Default landing page based on logged-in role
  useEffect(() => {
    if (!user) return;
    setActiveNav(getDefaultNavForRole(user.roleCode));
  }, [user?.id, user?.roleCode]);

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600 text-sm">
        Restoring FactoryFlow ERP session...
      </div>
    );
  }

  if (!user || !user.isActive || user.roleCode === 'PENDING') {
    return <LoginScreen />;
  }

  const handleSelectNav = (key: NavKey) => {
    if (canRoleAccessNav(user.roleCode, key)) {
      setActiveNav(key);
    } else {
      setActiveNav(getDefaultNavForRole(user.roleCode));
    }
  };

  const safeNav: NavKey = canRoleAccessNav(user.roleCode, activeNav)
    ? activeNav
    : getDefaultNavForRole(user.roleCode);

  const renderPage = () => {
    switch (safeNav) {
      case 'overview':
        return <OverviewPage onNavigate={handleSelectNav} />;
      case 'orders':
        return <OrdersPage onNavigate={handleSelectNav} />;
      case 'customers':
        return <CustomersPage />;
      case 'products':
        return <ProductsPage />;
      case 'inventory':
        return <InventoryPage />;
      case 'purchases':
        return <PurchasesPage />;
      case 'production':
        return <ProductionPage />;
      case 'boms':
        return <BomPage />;
      case 'invoices':
        return <InvoicesPage />;
      case 'payments':
        return <PaymentsPage />;
      case 'costing':
        return <CostingPage />;
      case 'reports':
        return <ReportsPage />;
      case 'audit':
        return <AuditTrailPage />;
      case 'users':
        return <UsersPage />;
      case 'settings':
        return <SettingsPage />;
      default:
        return <OverviewPage onNavigate={handleSelectNav} />;
    }
  };

  return (
    <Layout activeNav={safeNav} onSelectNav={handleSelectNav}>
      {renderPage()}
    </Layout>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <ErpWorkspace />
    </AuthProvider>
  );
}
