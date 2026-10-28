// The app's navigation tree, permission-filtered and translated — the single
// source both sidebar layouts (classic black rail and the modern light one)
// render from, so a new page only ever has to be added here.
import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Package, Truck, Wallet, MapPin, PieChart, ShoppingCart, Calculator, List, CircleDollarSign, Trash2, PackageSearch, ArrowRightLeft, TrendingUp, TrendingDown, BarChart3, Banknote, FileText, Building2, FileCheck, Network, BookOpen, CreditCard, AlertTriangle, PackageCheck, Tags, Warehouse, Calendar, CheckSquare, HandCoins, Store, History, Users, Megaphone, Target, Scale, ArrowDownUp, FlaskConical, User, ShieldCheck, Lock, BookText, SlidersHorizontal, Receipt, Clock, ClipboardEdit } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useLanguage } from '../context/LanguageContext';

export interface NavSubItem { label: string; path: string; icon: LucideIcon }
export interface NavItem { icon: LucideIcon; label: string; path: string; subItems?: NavSubItem[] }

export const useNavItems = (): NavItem[] => {
    const { hasPermission, currentUser } = useStore();
    const { t } = useLanguage();

    const navItems: NavItem[] = [];

    if (currentUser?.roleId === 'admin') {
        // The financial Admin Dashboard (AdminDashboardPage) — Admin's own
        // default landing page at /, see ProtectedApp in App.tsx. Not shown
        // to other roles since they land on the Sales Dashboard instead.
        navItems.push({ icon: LayoutDashboard, label: t('nav.dashboard'), path: '/' });
    }

    if (hasPermission('view_dashboard')) {
        // Price List is hidden from the menu; /price-list stays reachable by URL.
        navItems.push({ icon: CheckSquare, label: t('nav.todo'), path: '/todo' });
    }

    if (hasPermission('manage_orders') || hasPermission('create_orders') || hasPermission('view_orders')) {
        navItems.push({
            icon: Truck,
            label: t('nav.orders'),
            path: '/orders',
            subItems: [
                // The merged dashboard (Dashboard 2 + every classic card
                // section), pinned to the top — it's also the default landing
                // page at / for every user except Admin.
                { label: t('nav.salesDashboard'), path: '/sales-dashboard', icon: LayoutDashboard },
                { label: t('nav.allOrders'), path: '/orders', icon: List },
                // Orders Management 2 is hidden from the menu; /orders-management-2 stays reachable by URL.
                { label: t('nav.shippingDelivery'), path: '/orders/shipping', icon: Truck },
                // Payment Tracking is hidden from the menu; /payment-tracking stays
                // reachable by URL and its Record Receipt ledger-posting flow is unchanged.
                { label: t('nav.customerPayment'), path: '/customer-payment', icon: Receipt },
                { label: t('nav.scammers'), path: '/orders/scammers', icon: AlertTriangle },
                { label: t('nav.deletedOrders'), path: '/orders/deleted', icon: Trash2 },
                { label: t('nav.salesSetup'), path: '/orders/setup', icon: SlidersHorizontal }
            ]
        });
    }

    if (hasPermission('manage_accounting')) {
        navItems.push({
            icon: Calculator,
            label: t('nav.accounting'),
            path: '/accounting',
            subItems: [
                { label: t('nav.chartOfAccounts'), path: '/accounting/chart-of-accounts', icon: Network },
                { label: t('nav.journalEntries'), path: '/accounting/journal-entries', icon: BookOpen },
                { label: t('nav.generalLedger'), path: '/accounting/general-ledger', icon: BookText },
                { label: t('nav.revenue'), path: '/accounting/revenue', icon: CircleDollarSign },
                { label: t('nav.expense'), path: '/accounting/expense', icon: TrendingDown },
                { label: t('nav.accountsPayable'), path: '/accounting/payable', icon: Wallet },
                { label: t('nav.accountsReceivable'), path: '/accounting/receivable', icon: HandCoins },
                { label: t('nav.payments'), path: '/accounting/payments', icon: CreditCard }
            ]
        });
    }

    if (hasPermission('manage_procurement')) {
        navItems.push({
            icon: ShoppingCart,
            label: t('nav.procurement'),
            path: '/procurement',
            subItems: [
                { label: t('nav.purchaseDashboard'), path: '/procurement/dashboard', icon: LayoutDashboard },
                { label: t('nav.purchaseOrders'), path: '/procurement/purchase-orders', icon: FileCheck },
                { label: t('nav.receiving'), path: '/procurement/receiving', icon: PackageCheck },
                { label: t('nav.supplierBills'), path: '/procurement/supplier-bills', icon: Receipt },
                { label: t('nav.supplierPayments'), path: '/procurement/payments', icon: CreditCard },
                { label: t('nav.suppliers'), path: '/procurement/suppliers', icon: Building2 },
                { label: t('nav.purchaseReports'), path: '/procurement/purchase-reports', icon: Clock },
                { label: t('nav.purchaseSetup'), path: '/procurement/setup', icon: SlidersHorizontal }
            ]
        });
    }

    if (hasPermission('manage_orders')) {
        navItems.push({
            icon: Store,
            label: t('nav.wholesale'),
            path: '/wholesale',
            subItems: [
                { label: t('nav.wholesaleOrders'), path: '/wholesale/orders', icon: ShoppingCart },
                { label: t('nav.wholesaleGoodsShipped'), path: '/wholesale/goods-shipped', icon: Truck },
                { label: t('nav.wholesaleCustomers'), path: '/wholesale/customers', icon: Users },
                { label: t('nav.wholesalePayments'), path: '/wholesale/payments', icon: CreditCard },
                { label: t('nav.wholesaleSetup'), path: '/wholesale/setup', icon: SlidersHorizontal }
            ]
        });
    }

    if (hasPermission('manage_inventory') || hasPermission('view_inventory_stock')) {
        navItems.push({
            icon: Package,
            label: t('nav.inventory'),
            path: '/inventory',
            subItems: [
                { label: t('nav.inventoryDashboard'), path: '/inventory/dashboard', icon: LayoutDashboard },
                { label: t('nav.products'), path: '/inventory', icon: PackageSearch },
                { label: t('nav.categories'), path: '/inventory/categories', icon: Tags },
                { label: t('nav.warehouses'), path: '/inventory/warehouses', icon: Warehouse },
                { label: t('nav.stockMovements'), path: '/inventory/stock-movements', icon: ArrowRightLeft },
                { label: t('nav.adjustStock'), path: '/inventory/adjust-stock', icon: ClipboardEdit },
                { label: t('nav.inventoryReports'), path: '/inventory/reports', icon: BarChart3 },
                { label: t('nav.inventorySettings'), path: '/inventory/settings', icon: SlidersHorizontal }
            ]
        });
    }

    // HR & Payroll and CRM are hidden from the menu; /hr/attendance,
    // /hr/employees, /hr/leaves, /hr/payroll, /crm/leads, /crm/interactions
    // and /crm/quotations all stay reachable by URL.

    if (hasPermission('view_reports')) {
        navItems.push({
            icon: PieChart,
            label: t('nav.reportsCenter'),
            path: '/reports',
            subItems: [
                { label: t('nav.financialDashboard'), path: '/accounting/financial-dashboard', icon: LayoutDashboard },
                // These five (plus Financial Dashboard pinned above) point at the
                // same Accounting pages reached from the Accounting section — not
                // new routes, just a second way in for anyone who thinks of them
                // as "reports" first.
                { label: t('nav.financialReports'), path: '/accounting/financial-reports', icon: FileText },
                { label: t('nav.balanceSheet'), path: '/accounting/balance-sheet', icon: Scale },
                { label: t('nav.incomeStatement'), path: '/accounting/income-statement', icon: TrendingUp },
                { label: t('nav.cashInOut'), path: '/accounting/cash-in-out', icon: ArrowDownUp },
                { label: t('nav.generalLedger'), path: '/accounting/general-ledger', icon: BookText },
                // Sales Overview, Top Products, Inventory and Financials are
                // hidden from the menu; /reports/sales, /reports/products,
                // /reports/inventory and /reports/financials stay reachable by URL.
                { label: t('nav.staffPerformance'), path: '/reports/staff', icon: Users },
                { label: t('nav.purchaseCost'), path: '/reports/purchase-cost', icon: Banknote },
                { label: t('nav.shippingCompanies'), path: '/reports/shipping', icon: Truck },
            ]
        });
    }

    if (hasPermission('manage_income_expense')) {
        // The prediction pages and the CPA tracker live in their own section;
        // the URLs stay under /income-expense/* so saved links keep working.
        navItems.push({
            icon: Target,
            label: t('nav.profitCpa'),
            path: '/income-expense/cpa-tracker',
            subItems: [
                { label: t('nav.incomePrediction'), path: '/income-expense/prediction', icon: Calendar },
                { label: t('nav.pagePrediction'), path: '/income-expense/page-prediction', icon: Megaphone },
                { label: t('nav.productPrediction'), path: '/income-expense/product-prediction', icon: BarChart3 },
                { label: t('nav.staffPrediction'), path: '/income-expense/staff-prediction', icon: Users },
                { label: t('nav.cpaTracker'), path: '/income-expense/cpa-tracker', icon: Target },
                { label: t('nav.creativeTesting'), path: '/income-expense/creative-testing', icon: FlaskConical }
            ]
        });
    }

    if (hasPermission('view_dashboard')) {
        navItems.push({ icon: MapPin, label: t('nav.shippingPoint'), path: '/shipping-point' });
    }


    // Team: the people-management pages gathered in one group. Each entry keeps
    // its own permission, so the group only shows what the user can open.
    const teamSubs: NavSubItem[] = [];
    if (hasPermission('manage_users')) {
        teamSubs.push({ label: t('nav.teamUsers'), path: '/users', icon: User });
        teamSubs.push({ label: t('nav.rolesPermissions'), path: '/users/roles', icon: ShieldCheck });
    }
    if (hasPermission('view_dashboard')) {
        teamSubs.push({ label: t('nav.activityLog'), path: '/activity-log', icon: History });
    }
    if (hasPermission('manage_settings')) {
        teamSubs.push({ label: t('nav.security'), path: '/settings/security', icon: Lock });
    }
    if (teamSubs.length > 0) {
        navItems.push({ icon: Users, label: t('nav.team'), path: teamSubs[0].path, subItems: teamSubs });
    }

    return navItems;
};
