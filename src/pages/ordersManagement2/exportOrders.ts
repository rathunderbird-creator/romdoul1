// XLSX export for Orders Management 2 — same columns as classic Orders.tsx's
// handleExportExcel, plus Owed / Received / Deposit so the sheet reconciles
// against the summary strip. The xlsx library (~140 KB gzipped) is imported
// on demand so it never weighs on the page's own chunk.
import type { Order } from './metrics';
import { orderBalance, receivedAmountOf } from './metrics';

// Pure and unit-testable: one flat record per order.
export const buildExportRows = (orders: Order[]): Record<string, string | number>[] =>
    orders.map(order => ({
        'Order ID': order.id,
        'Date': new Date(order.date).toLocaleDateString(),
        'Customer': order.customer?.name || 'N/A',
        'Phone': order.customer?.phone || 'N/A',
        'Address': order.customer?.address || 'N/A',
        'City': order.customer?.city || 'N/A',
        'Page': order.pageSource || order.customer?.page || 'N/A',
        'Platform': order.customer?.platform || 'N/A',
        'Salesman': order.salesman || 'N/A',
        'Customer Care': order.customerCare || 'N/A',
        'Items': order.items.map(i => `${i.name} (${i.quantity})`).join(', '),
        'Total Amount': order.total,
        'Deposit': order.depositAmount || 0,
        'Received': receivedAmountOf(order),
        'Owed': orderBalance(order),
        'Payment Method': order.paymentMethod,
        'Payment Status': order.paymentStatus || 'Paid',
        'Settle Date': order.settleDate ? new Date(order.settleDate).toLocaleDateString() : 'N/A',
        'Shipping Company': order.shipping?.company || 'N/A',
        'Shipping Status': order.shipping?.status || 'Pending',
        'Tracking Number': order.shipping?.trackingNumber || 'N/A',
        'Remarks': order.remark || '',
    }));

// Writes Orders_<label>_<date>.xlsx into the browser's download folder.
export const exportOrdersXlsx = async (orders: Order[], label: string): Promise<void> => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(buildExportRows(orders));
    XLSX.utils.book_append_sheet(wb, ws, 'Orders');
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Orders_${label}_${dateStr}.xlsx`);
};
