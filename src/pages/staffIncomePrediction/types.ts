// Prop contracts for Prediction by Staff. The view is pure (no store /
// router access) so src/dev/staffIncomePrediction-preview.tsx can render it
// with fixtures; the container (StaffIncomePredictionPage.tsx) resolves
// store and URL state and hands plain data down. No actions to persist —
// this screen is fully derived, read-only, like Prediction by Product.
import type { Product, User } from '../../types';
import type { DateRange } from '../../utils/dateRange';
import type { Order } from './metrics';

export type Translate = (key: string) => string;
export type Language = 'en' | 'km';

export interface SectionError { message: string; retry: () => void }

// Date range + drill-down, both held in the URL (see urlState.ts). The range is
// inclusive and defaults to the current calendar month.
export interface StaffIncomeUrlState {
    range: DateRange;
    staff: string | null;   // null = overview; '' = the unassigned bucket's detail
}

export interface StaffIncomeData {
    sales: Order[];          // the range's orders (mapped Sale objects)
    products: Product[];     // catalogue, for purchase costs
    users: User[];           // for monthlyTarget lookups
    configSalesmen: string[]; // Settings → Salesmen
    now: Date;
}

export interface StaffIncomeActions {
    onRangeChange: (range: DateRange) => void;
    onOpenStaff: (staff: string) => void;
    onBack: () => void;
    onRefresh: () => void;
}

export interface StaffIncomeViewProps {
    state: StaffIncomeUrlState;
    data: StaffIncomeData;
    loading: boolean;
    refreshing: boolean;
    error: SectionError | null;
    isMobile: boolean;
    t: Translate;
    language: Language;
    actions: StaffIncomeActions;
}
