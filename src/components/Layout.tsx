import React, { useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  Warehouse,
  Truck,
  Factory,
  Layers,
  FileSpreadsheet,
  CreditCard,
  Calculator,
  BarChart3,
  ShieldAlert,
  UserCog,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  LogOut,
} from 'lucide-react';
import { useAuth, RoleCode } from '../context/AuthContext';

export type NavKey =
  | 'overview'
  | 'orders'
  | 'customers'
  | 'products'
  | 'inventory'
  | 'purchases'
  | 'production'
  | 'boms'
  | 'invoices'
  | 'payments'
  | 'costing'
  | 'reports'
  | 'audit'
  | 'users'
  | 'settings';

export interface NavItem {
  key: NavKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: RoleCode[];
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, roles: ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'SALESMAN', 'AUDITOR'] },
  { key: 'orders', label: 'Orders', icon: ShoppingCart, roles: ['OWNER', 'ADMIN', 'SALESMAN', 'AUDITOR'] },
  { key: 'customers', label: 'Customers', icon: Users, roles: ['OWNER', 'ADMIN', 'SALESMAN', 'AUDITOR'] },
  { key: 'products', label: 'Products', icon: Package, roles: ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'SALESMAN', 'AUDITOR'] },
  { key: 'inventory', label: 'Inventory', icon: Warehouse, roles: ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'] },
  { key: 'purchases', label: 'Purchases', icon: Truck, roles: ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'] },
  { key: 'production', label: 'Production', icon: Factory, roles: ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'] },
  { key: 'boms', label: 'Bill of Materials', icon: Layers, roles: ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'] },
  { key: 'invoices', label: 'GST Invoices', icon: FileSpreadsheet, roles: ['OWNER', 'ADMIN', 'SALESMAN', 'AUDITOR'] },
  { key: 'payments', label: 'Payments', icon: CreditCard, roles: ['OWNER', 'ADMIN', 'AUDITOR'] },
  { key: 'costing', label: 'Costing', icon: Calculator, roles: ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'] },
  { key: 'reports', label: 'Reports', icon: BarChart3, roles: ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'] },
  { key: 'audit', label: 'Audit Trail', icon: ShieldAlert, roles: ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR', 'AUDITOR'] },
  { key: 'users', label: 'User Management', icon: UserCog, roles: ['OWNER', 'ADMIN', 'AUDITOR'] },
  { key: 'settings', label: 'Settings', icon: Settings, roles: ['OWNER', 'ADMIN', 'AUDITOR'] },
];

export function canRoleAccessNav(roleCode: RoleCode | undefined, key: NavKey): boolean {
  if (!roleCode || roleCode === 'PENDING') return false;
  const item = NAV_ITEMS.find((i) => i.key === key);
  return item ? item.roles.includes(roleCode) : false;
}

export const Layout: React.FC<{
  activeNav: NavKey;
  onSelectNav: (key: NavKey) => void;
  children: React.ReactNode;
}> = ({ activeNav, onSelectNav, children }) => {
  const { user, company, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeItem = NAV_ITEMS.find((i) => i.key === activeNav) || NAV_ITEMS[0];

  const handleNavClick = (key: NavKey) => {
    onSelectNav(key);
    setMobileOpen(false);
  };

  const visibleNavItems = user
    ? NAV_ITEMS.filter((item) => item.roles.includes(user.roleCode))
    : [];

  const renderNavLinks = (isCollapsed: boolean, isMobile = false) => (
    <nav
      className={`flex-1 py-3 px-2 space-y-0.5 ${
        isMobile ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
      }`}
      aria-label="Main ERP Navigation"
    >
      {visibleNavItems.map((item) => {
        const Icon = item.icon;
        const active = item.key === activeNav;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => handleNavClick(item.key)}
            title={item.label}
            aria-current={active ? 'page' : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2 [@media(max-height:760px)]:py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              active
                ? 'bg-indigo-600 text-white'
                : 'text-slate-300 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            {!isCollapsed && <span className="truncate">{item.label}</span>}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="h-dvh w-full flex overflow-hidden bg-slate-50">
      {/* Desktop Deep Navy Collapsible Sidebar — Permanently Fixed */}
      <aside
        className={`hidden lg:flex flex-col fixed top-0 left-0 h-dvh bg-[#0F172A] text-white border-r border-slate-800 transition-[width] duration-150 shrink-0 z-50 overflow-hidden ${
          collapsed ? 'w-[72px]' : 'w-[252px]'
        }`}
      >
        <div className="h-14 shrink-0 px-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-indigo-600 flex items-center justify-center shrink-0">
              <Factory className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            {!collapsed && (
              <span className="font-bold text-base tracking-tight text-white truncate">FactoryFlow</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1 text-slate-400 hover:text-white rounded"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {renderNavLinks(collapsed, false)}

        <div className="p-3 shrink-0 border-t border-slate-800">
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
          >
            <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span>Sign Out / Switch Role</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-[264px] max-w-[85vw] h-dvh bg-[#0F172A] text-white flex flex-col z-10 overflow-hidden">
            <div className="h-14 shrink-0 px-4 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-indigo-600 flex items-center justify-center">
                  <Factory className="w-4 h-4 text-white" aria-hidden="true" />
                </div>
                <span className="font-bold text-base tracking-tight text-white">FactoryFlow</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="p-1.5 text-slate-300 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderNavLinks(false, true)}
            <div className="p-3 shrink-0 border-t border-slate-800">
              <button
                type="button"
                onClick={logout}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-md"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out / Switch Role</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Shell — Independent Vertical Scroll */}
      <div
        id="erp-main-scroll"
        className={`flex-1 flex flex-col min-w-0 h-dvh overflow-y-auto overflow-x-hidden transition-[margin-left] duration-150 ${
          collapsed ? 'lg:ml-[72px]' : 'lg:ml-[252px]'
        }`}
      >
        {/* Top Bar Contract: Breadcrumb Left — User Identity & Switch Role Right */}
        <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0 truncate">
              <span className="text-slate-500 hidden sm:inline truncate">
                {company?.companyName || 'FactoryFlow ERP'}
              </span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 truncate">{activeItem.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-600 whitespace-nowrap">
              <span className="font-semibold text-slate-900">{user?.name}</span>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="font-mono text-indigo-700 font-medium">
                {user?.roleCode.replace(/_/g, ' ')}
              </span>
              {user?.roleCode === 'AUDITOR' && (
                <>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className="text-amber-700 font-medium">Read-Only</span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={logout}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Switch Role
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
};
