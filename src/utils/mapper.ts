import type { Sale } from '../types';

export const mapSaleEntity = (s: any): Sale => ({
    id: s.id,
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
