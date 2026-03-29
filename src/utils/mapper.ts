import type { Sale } from '../types';

let _printedCache: Set<string> | null = null;
const getPrintedSet = () => {
    if (!_printedCache) {
        try {
            _printedCache = new Set(JSON.parse(localStorage.getItem('jbl_pos_printed_orders') || '[]'));
        } catch {
            _printedCache = new Set();
        }
    }
    return _printedCache;
};

export const markOrderAsPrintedLocal = (id: string) => {
    const set = getPrintedSet();
    set.add(id);
    localStorage.setItem('jbl_pos_printed_orders', JSON.stringify(Array.from(set)));
};

export const mapSaleEntity = (s: any): Sale => ({
    id: s.id,
    isPrinted: getPrintedSet().has(s.id),
    total: Number(s.total),
    discount: Number(s.discount),
    date: s.date,
    paymentMethod: s.payment_method as any,
    type: s.type as any,
    salesman: s.salesman,
    customerCare: s.customer_care,
    remark: s.remark,
    amountReceived: Number(s.amount_received),
    settleDate: s.settle_date,
    paymentStatus: s.payment_status as any,
    orderStatus: s.order_status as any,
    shipping: s.shipping_status ? {
        company: s.shipping_company,
        trackingNumber: s.tracking_number || '',
        status: s.shipping_status as any,
        cost: Number(s.shipping_cost || 0),
        staffName: ''
    } : undefined,
    pageSource: s.page_source || s.customer_snapshot?.page, // Read from new column, fallback to snapshot
    customer: s.customer_snapshot,
    lastEditedAt: s.last_edited_at,
    lastEditedBy: s.last_edited_by,
    items: (s.items || []).map((i: any) => ({
        id: i.product_id,
        name: i.name,
        price: Number(i.price),
        quantity: i.quantity,
        image: i.image,
        model: '', // Optional in CartItem
        stock: 0, // Not needed in history
        category: ''
    }))
});
