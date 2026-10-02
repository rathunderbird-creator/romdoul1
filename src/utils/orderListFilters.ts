// Filters a page can hand to the Orders list when navigating to it, e.g.
//   navigate('/orders', { state: { filters: { statuses: ['Shipped'] } } })
// Orders.tsx applies these on mount (see its `location.state.filters` effect).
// Every field is optional; omitted fields are RESET to "all" so a click-through
// shows exactly the subset the caller meant, not that subset intersected with
// whatever the user last filtered by.

export interface OrderListFilters {
    statuses?: string[];      // shipping/order statuses (Pending, Shipped, …)
    payStatuses?: string[];   // Unpaid, Deposit, Paid, Cancel, Get File
    salesman?: string;        // exact salesman name ('All' = any)
    pages?: string[];         // page names; PAGE_UNKNOWN = the no-page bucket
    shippingCos?: string[];   // courier names
    dateRange?: { start: string; end: string }; // YYYY-MM-DD, '' = open
    search?: string;
}

// The Orders page's sentinel for "no page recorded" in its page filter (its
// pageOrFilter matches orders with neither page_source nor a snapshot page).
// Lives here so other lazy chunks can target that bucket without importing
// the whole Orders module.
export const PAGE_UNKNOWN = 'Unknown Page';

export const ORDER_LIST_FILTERS_STATE_KEY = 'filters';

export const orderListState = (filters: OrderListFilters) => ({ [ORDER_LIST_FILTERS_STATE_KEY]: filters });
