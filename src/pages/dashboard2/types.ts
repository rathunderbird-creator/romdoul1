// Prop contracts shared by the Dashboard2 view and its section components.
// The view is pure (no store / auth access) so it can be rendered with fixture
// data in src/dev/dashboard2-preview.tsx.
import type { Product } from '../../types';
import type { OrderListFilters } from '../../utils/orderListFilters';
import type { Order, DateRange, KpiSummary, PipelineStage, DayPoint, GroupRow, ProductRow, PendingItem } from './metrics';

export type Translate = (key: string) => string;

export interface SectionError { message: string; retry: () => void }

// Everything the container resolves for the view.
export interface Dashboard2Data {
    range: DateRange;
    previous: DateRange | null;      // equal-length period before `range` (null for open ranges)
    orders: Order[];                 // orders in `range`
    previousOrders: Order[];         // orders in `previous`
    products: Product[];             // catalogue (all-time)
    stockIn: number;                 // stock_movements 'in' pieces in range
    stockOut: number;                // stock_movements 'out' pieces in range
    now: Date;                       // clock for "pending since" ages
}

export interface Dashboard2Derived {
    kpis: KpiSummary;
    previousKpis: KpiSummary | null;
    pipeline: Record<PipelineStage, number>;
    otherStatuses: Record<string, number>;
    series: DayPoint[];
    lowStock: Product[];
    pending: PendingItem[];
    missingTracking: Order[];
    missingTrackingCouriers: string[];
}

export interface Dashboard2Actions {
    onRangeChange: (range: DateRange) => void;
    onRefresh: () => void;
    // Navigate to the order list showing exactly this subset (spec §6.1).
    onOpenOrders: (filters: OrderListFilters) => void;
    onNewOrder: () => void;
    onOpenInventory: () => void;
}

export interface Dashboard2ViewProps {
    data: Dashboard2Data;
    loading: boolean;                 // first load → skeletons
    refreshing: boolean;              // background refresh → spinner on button only
    salesError: SectionError | null;  // orders fetch failed
    inventoryError: SectionError | null; // stock movements fetch failed
    actions: Dashboard2Actions;
    t: Translate;
    language: 'en' | 'km';
    isMobile: boolean;
}

// Section components -------------------------------------------------------

export interface HeroKpisProps {
    kpis: KpiSummary;
    previousKpis: KpiSummary | null;
    previousLabel: string;            // "Sep 7" or "previous 7 days"
    range: DateRange;
    onOpenOrders: Dashboard2Actions['onOpenOrders'];
    t: Translate;
}

export interface PipelineProps {
    counts: Record<PipelineStage, number>;
    other: Record<string, number>;
    range: DateRange;
    onOpenOrders: Dashboard2Actions['onOpenOrders'];
    t: Translate;
}

export interface AttentionSectionProps {
    lowStock: Product[];
    pending: PendingItem[];
    missingTracking: Order[];
    missingTrackingCouriers: string[];
    range: DateRange;
    onOpenOrders: Dashboard2Actions['onOpenOrders'];
    onOpenInventory: () => void;
    t: Translate;
}

export interface CollectionChartProps {
    series: DayPoint[];
    range: DateRange;
    onOpenOrders: Dashboard2Actions['onOpenOrders'];
    t: Translate;
}

export type PerformanceTab = 'salesmen' | 'pages' | 'shipping' | 'products';

export interface PerformancePanelProps {
    orders: Order[];
    products: Product[];
    range: DateRange;
    onOpenOrders: Dashboard2Actions['onOpenOrders'];
    onOpenInventory: () => void;
    t: Translate;
    isMobile: boolean;
    // Pure helpers are injected so the panel stays testable with fixtures.
    groupOrders: (orders: Order[], kind: 'salesman' | 'page' | 'shippingCo', statusFilter: string) => GroupRow[];
    productRows: (orders: Order[], products: Product[], statusFilter: string) => ProductRow[];
}

export interface InventoryDetailProps {
    products: Product[];
    lowStockCount: number;
    stockIn: number;
    stockOut: number;
    error: SectionError | null;
    onOpenInventory: () => void;
    t: Translate;
}
