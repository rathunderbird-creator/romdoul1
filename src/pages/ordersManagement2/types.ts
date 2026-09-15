// Prop contracts for Orders Management 2's view and section components. The
// view is pure (no store/auth/router access) so it can be rendered with
// fixture data in src/dev/ordersManagement2-preview.tsx, matching the
// Dashboard 2 pattern.
import type { Sale, Product } from '../../types';
import type { OM2Filters } from './urlFilters';
import type { Order, SortState } from './metrics';

export type Translate = (key: string) => string;

export interface SectionError { message: string; retry: () => void }

// A pending edit the drawer wants applied. `expected` carries the values the
// drawer showed the user in its confirmation, so the caller can build an
// accurate undo (and detect if the row changed underneath it).
export interface OrderEdit {
    orderId: string;
    paymentStatus?: Sale['paymentStatus'];
    amountReceived?: number;
    paymentMethod?: Sale['paymentMethod'];
    // undefined = leave alone; null = clear; a string = set to this date.
    settleDate?: string | null;
    // Undefined = "leave the shipping/order status alone"; any real status
    // value (including the order's own current one) explicitly requests
    // that status, routed through updateOrderStatus's transition rules.
    orderStatus?: NonNullable<Sale['shipping']>['status'];
    trackingNumber?: string;
    shippingCompany?: string;
    address?: string;
    // The drawer's "Page" field displays/edits order.pageSource (a flat
    // field, the same one the Filters popover's "Pages" list uses) — NOT
    // customer.page, a different field the classic table happens to also
    // call "Page". Named to match what's actually being edited.
    pageSource?: string;
    salesman?: string;
    customerCare?: string;
    remark?: string;
}

export interface OM2Data {
    orders: Order[];          // current page, server-filtered + sorted
    totalCount: number;       // matching the filters, ignoring pagination
    rangeOrders: Order[];     // ALL orders matching filters except pagination — summary strip + status segments
    products: Product[];
    now: Date;
}

export interface OM2Actions {
    onFiltersChange: (next: OM2Filters | ((prev: OM2Filters) => OM2Filters)) => void;
    onRefresh: () => void;
    onNewOrder: () => void;
    onExport: () => void;
    onSaveEdit: (edit: OrderEdit) => Promise<void>;
    onUndoEdit: (edit: OrderEdit, previous: OrderEdit) => Promise<void>;
    onBulkAddTracking: (updates: Array<{ orderId: string; trackingNumber: string }>) => Promise<void>;
    onBulkMarkShipped: (orderIds: string[]) => Promise<void>;
    onBulkPrint: (orderIds: string[]) => void;
    onBulkExport: (orderIds: string[]) => void;
    // Mirrors classic Orders.tsx's BulkEditModal onApply contract exactly
    // (src/components/BulkEditModal.tsx) — that component is reused as-is
    // here, so its prop shape is the source of truth for `field`/`value`.
    onBulkEdit: (orderIds: string[], field: 'date' | 'status' | 'paymentStatus' | 'settleDate', value: string, settleDate?: string, payBy?: string) => Promise<void>;
}

export interface OM2ViewProps {
    filters: OM2Filters;
    data: OM2Data;
    loading: boolean;
    refreshing: boolean;
    salesError: SectionError | null;
    actions: OM2Actions;
    t: Translate;
    isMobile: boolean;
    salesmen: string[];       // for the Filters popover + drawer
    shippingCompanies: string[];
    pageSources: string[];
    customerCare: string[];   // for the drawer's editable Customer care field
    paymentMethods: string[]; // for the drawer's editable Pay by field
    columnLabels: Record<string, string>; // for the Columns menu
    visibleColumns: string[];
    onVisibleColumnsChange: (cols: string[]) => void;
}

export interface DrawerState {
    order: Order | null;
    isOpen: boolean;
}

export type PillTone = 'neutral' | 'amber' | 'red' | 'green' | 'blue' | 'violet';

export interface SortableColumn {
    key: SortState['key'];
    label: string;
}
