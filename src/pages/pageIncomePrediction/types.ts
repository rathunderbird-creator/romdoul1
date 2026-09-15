// Prop contracts for Prediction by Page. The view is pure (no store / router
// access) so src/dev/pageIncomePrediction-preview.tsx can render it with
// fixtures; the container (PageIncomePredictionPage.tsx) resolves store,
// header, toast and URL state and hands plain data + callbacks down.
import type { Product } from '../../types';
import type { Order, PageInputRow, SiblingRow, InputField } from './metrics';

export type Translate = (key: string) => string;
export type Language = 'en' | 'km';

export interface SectionError { message: string; retry: () => void }

// Month + drill-down, both held in the URL (see urlState.ts).
export interface PageIncomeUrlState {
    month: string;          // YYYY-MM
    page: string | null;    // null = overview; '' = the unassigned bucket's detail
}

// Everything the container resolves for one month.
export interface PageIncomeData {
    sales: Order[];                       // the month's orders (mapped Sale objects)
    inputs: PageInputRow[];               // page_income_predictions rows for the month
    sibling: SiblingRow[] | null;         // income_predictions rows; null = unreadable
    products: Product[];                  // catalogue, for purchase costs
    shippingRates: Record<string, number>;
    configPages: string[];                // Settings → Pages
    now: Date;                            // clock captured at fetch time
}

export interface PageIncomeActions {
    onMonthChange: (month: string) => void;
    onOpenPage: (page: string) => void;
    onBack: () => void;
    onRefresh: () => void;
    // Persist one manual input. Resolves once the row is stored; rejects on
    // failure (the container has already shown a toast by then).
    onCommitInput: (date: string, page: string, field: InputField, value: number | null) => Promise<void>;
}

export interface PageIncomeViewProps {
    state: PageIncomeUrlState;
    data: PageIncomeData;
    loading: boolean;                     // first load → skeletons
    refreshing: boolean;                  // background reload → spinner on the button only
    error: SectionError | null;           // orders fetch failed
    missingTable: boolean;                // page_income_predictions absent on this instance
    canEdit: boolean;                     // manage_income_expense
    isMobile: boolean;
    t: Translate;
    language: Language;
    actions: PageIncomeActions;
}
