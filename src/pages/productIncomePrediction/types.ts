// Prop contracts for Prediction by Product. The view is pure (no store /
// router access) so src/dev/productIncomePrediction-preview.tsx can render
// it with fixtures; the container (ProductIncomePredictionPage.tsx) resolves
// store, header and URL state and hands plain data down. There are no
// actions to persist — this screen is fully derived, read-only.
import type { Product } from '../../types';
import type { DateRange } from '../../utils/dateRange';
import type { Order } from './metrics';

export type Translate = (key: string) => string;
export type Language = 'en' | 'km';

export interface SectionError { message: string; retry: () => void }

// Date range + drill-down, both held in the URL (see urlState.ts). The range is
// any inclusive span of local calendar days (default: the current month).
export interface ProductIncomeUrlState {
    range: DateRange;           // inclusive local YYYY-MM-DD .. YYYY-MM-DD
    productId: string | null;   // null = overview; '' = the "unknown product" bucket's detail
}

export interface ProductIncomeData {
    sales: Order[];              // the range's orders (mapped Sale objects)
    products: Product[];         // catalogue, for purchase costs / names / categories
    now: Date;                   // clock captured at fetch time
}

export interface ProductIncomeActions {
    onRangeChange: (range: DateRange) => void;
    onOpenProduct: (productId: string) => void;
    onBack: () => void;
    onRefresh: () => void;
}

export interface ProductIncomeViewProps {
    state: ProductIncomeUrlState;
    data: ProductIncomeData;
    loading: boolean;
    refreshing: boolean;
    error: SectionError | null;
    isMobile: boolean;
    t: Translate;
    language: Language;
    actions: ProductIncomeActions;
}
