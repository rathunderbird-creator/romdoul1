// The app's navigation tree, permission-filtered and translated — the single
// source both sidebar layouts (classic black rail and the modern light one)
// render from, so a new page only ever has to be added here.
import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Package, Truck, Wallet, MapPin, PieChart, CalendarClock, Briefcase, HeartHandshake, ShoppingCart, Calculator, List, CircleDollarSign, Trash2, PackageSearch, ArrowRightLeft, TrendingUp, TrendingDown, DollarSign, BarChart3, Award, Banknote, CalendarOff, UserPlus, MessageSquare, FileText, Building2, FileCheck, Network, BookOpen, CreditCard, AlertTriangle, PackageCheck, Tags, Warehouse, Calendar, CheckSquare, HandCoins, Store, History, Users, Megaphone, Target, Scale, ArrowDownUp, FlaskConical, User, ShieldCheck, Lock, BookText, SlidersHorizontal, Receipt } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useLanguage } from '../context/LanguageContext';

export interface NavSubItem { label: string; path: string; icon: LucideIcon }
export interface NavItem { icon: LucideIcon; label: string; path: string; subItems?: NavSubItem[] }

export const useNavItems = (): NavItem[] => {
    const { hasPermission } = useStore();
    const { t } = useLanguage();

    const navItems: NavItem[] = [];

    if (hasPermission('view_dashboard')) {
        // One dashboard entry: / is the merged dashboard (Dashboard 2 + every
        // classic card section); /dashboard-classic stays reachable by URL.
        navItems.push({ icon: LayoutDashboard, label: t('nav.dashboard'), path: '/' });
        // Price List is hidden from the menu; /price-list stays reachable by URL.
        navItems.push({ icon: CheckSquare, label: t('nav.todo'), path: '/todo' });
    }

    if (hasPermission('manage_orders') || hasPermission('create_orders') || hasPermission('view_orders')) {
        navItems.push({
            icon: Truck,
            label: t('nav.orders'),
            path: '/orders',
            subItems: [
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
                { label: t('nav.balanceSheet'), path: '/accounting/balance-sheet', icon: Scale },
                { label: t('nav.incomeStatement'), path: '/accounting/income-statement', icon: TrendingUp },
                { label: t('nav.cashInOut'), path: '/accounting/cash-in-out', icon: ArrowDownUp },
                { label: t('nav.accountsPayable'), path: '/accounting/payable', icon: Wallet },
                { label: t('nav.accountsReceivable'), path: '/accounting/receivable', icon: HandCoins },
                { label: t('nav.payments'), path: '/accounting/payments', icon: CreditCard }
            ]
        });
    }

    if (hasPermission('manage_income_expense')) {
        navItems.push({
            icon: Wallet,
            label: t('nav.incomeExpense'),
            path: '/income-expense',
            subItems: [
                { label: t('nav.allTransactions'), path: '/income-expense', icon: ArrowRightLeft },
                { label: t('nav.income'), path: '/income-expense/income', icon: TrendingUp },
                { label: t('nav.expense'), path: '/income-expense/expense', icon: TrendingDown },
                { label: t('nav.revenue'), path: '/income-expense/revenue', icon: DollarSign }
            ]
        });
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
                { label: t('nav.wholesaleCustomers'), path: '/wholesale/customers', icon: Users },
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
                { label: t('nav.products'), path: '/inventory', icon: PackageSearch },
                { label: t('nav.categories'), path: '/inventory/categories', icon: Tags },
                { label: t('nav.warehouses'), path: '/inventory/warehouses', icon: Warehouse },
                { label: t('nav.stockMovements'), path: '/inventory/stock-movements', icon: ArrowRightLeft }
            ]
        });
    }

    if (hasPermission('manage_hr') || hasPermission('manage_attendance')) {
        navItems.push({
            icon: Briefcase,
            label: t('nav.hrPayroll'),
            path: '/hr',
            subItems: [
                { label: t('nav.attendance'), path: '/hr/attendance', icon: CalendarClock },
                { label: t('nav.employees'), path: '/hr/employees', icon: Users },
                { label: t('nav.leaves'), path: '/hr/leaves', icon: CalendarOff },
                { label: t('nav.payroll'), path: '/hr/payroll', icon: Banknote }
            ]
        });
    }

    if (hasPermission('manage_crm')) {
        navItems.push({
            icon: HeartHandshake,
            label: t('nav.crm'),
            path: '/crm',
            subItems: [
                { label: t('nav.leads'), path: '/crm/leads', icon: UserPlus },
                { label: t('nav.interactions'), path: '/crm/interactions', icon: MessageSquare },
                { label: t('nav.quotations'), path: '/crm/quotations', icon: FileText }
            ]
        });
    }

    if (hasPermission('view_reports')) {
        navItems.push({
            icon: PieChart,
            label: t('nav.reportsCenter'),
            path: '/reports',
            subItems: [
                { label: t('nav.salesOverview'), path: '/reports/sales', icon: BarChart3 },
                { label: t('nav.topProducts'), path: '/reports/products', icon: Award },
                { label: t('nav.inventory'), path: '/reports/inventory', icon: Package },
                { label: t('nav.financials'), path: '/reports/financials', icon: DollarSign },
                { label: t('nav.staffPerformance'), path: '/reports/staff', icon: Users },
                { label: t('nav.shippingCompanies'), path: '/reports/shipping', icon: Truck },
                { label: t('nav.purchaseCost'), path: '/reports/purchase-cost', icon: Banknote },
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
