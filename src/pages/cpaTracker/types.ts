// Prop contracts for the Profit & CPA Tracker. The view is pure (no store /
// router access) so src/dev/cpaTracker-preview.tsx can render it with
// fixtures; the container (CpaTrackerPage.tsx) resolves store, header, toast
// and URL state and hands plain data + callbacks down.
import type { Product } from '../../types';
import type { DateRange } from '../../utils/dateRange';
import type { Order, DailyEntryRow, ProductSettingRow, EntryPatch, SettingField } from './metrics';

export type Translate = (key: string) => string;
export type Language = 'en' | 'km';

export interface SectionError { message: string; retry: () => void }

export type CpaTab = 'daily' | 'summary' | 'weekly' | 'unit';
export const CPA_TABS: CpaTab[] = ['daily', 'summary', 'weekly', 'unit'];

// Date range + tab + the daily table's filters, all held in the URL.
export interface CpaUrlState {
    range: DateRange;
    tab: CpaTab;
    page: string | null;       // daily filter: null = all pages ('' = the no-page bucket)
    product: string | null;    // daily filter: null = all products ('' = the unknown-product bucket)
}

export interface CpaData {
    sales: Order[];
    entries: DailyEntryRow[];
    settings: ProductSettingRow[];
    products: Product[];       // whole catalogue, active AND inactive
    configPages: string[];     // Settings → Pages (for the add-entry form)
    now: Date;
}

export interface CpaActions {
    onStateChange: (next: Partial<CpaUrlState>) => void;
    onRefresh: () => void;
    // Persist daily input field(s) of one row (one upsert) / one unit-economics
    // setting. Resolve once stored; reject on failure (the container has
    // already shown a toast by then).
    onCommitEntry: (date: string, page: string, productId: string, patch: EntryPatch) => Promise<void>;
    onCommitSetting: (productId: string, field: SettingField, value: number | null) => Promise<void>;
}

export interface CpaViewProps {
    state: CpaUrlState;
    data: CpaData;
    loading: boolean;          // first load → skeletons
    refreshing: boolean;       // background reload → spinner on the button only
    ready: boolean;            // the range's data has loaded (false after a failed first load)
    error: SectionError | null;
    missingTables: boolean;    // cpa_* tables absent on this instance → inputs disabled
    canEdit: boolean;          // manage_income_expense
    isMobile: boolean;
    t: Translate;
    language: Language;
    actions: CpaActions;
}
