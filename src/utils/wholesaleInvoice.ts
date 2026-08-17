import type { WholesaleOrder } from '../types';

export interface InvoiceStoreInfo {
    storeName: string;
    storeAddress?: string;
    phone?: string;
    email?: string;
    logo?: string;
}

const esc = (s: any) =>
    String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/**
 * Opens a clean A4 invoice for a wholesale order in a new window and triggers
 * the browser print dialog (customers get it printed or saved as PDF).
 */
export const printWholesaleInvoice = (order: WholesaleOrder, store: InvoiceStoreInfo, warehouseName?: string) => {
    const fmt = (n: number) => '$' + (Number(n) || 0).toFixed(2);
    const d = (v?: string) => (v ? new Date(v).toLocaleDateString('en-GB').replace(/\//g, '-') : '—');
    const inv = order.invoice_number || `WO-${order.id.slice(0, 8).toUpperCase()}`;
    const total = order.total_amount || 0;
    const paid = order.amount_paid || 0;
    const balance = total - paid;
    const payStatus = balance <= 0.005 ? 'PAID' : paid > 0 ? 'PARTIALLY PAID' : 'UNPAID';
    const payColor = balance <= 0.005 ? '#059669' : paid > 0 ? '#D97706' : '#DC2626';

    const rows = (order.items || []).map((it, i) => `
        <tr>
            <td class="c muted">${i + 1}</td>
            <td>${esc(it.product_name || 'Unknown')}</td>
            <td class="c">${it.quantity || 0}</td>
            <td class="r">${fmt(it.unit_price || 0)}</td>
            <td class="r"><strong>${fmt((it.quantity || 0) * (it.unit_price || 0))}</strong></td>
        </tr>`).join('');

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Invoice ${esc(inv)}</title>
<link href="https://fonts.googleapis.com/css2?family=Battambang:wght@400;700&display=swap" rel="stylesheet">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', 'Battambang', Arial, sans-serif; color: #111827; padding: 40px; font-size: 13px; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
    .brand { display: flex; gap: 14px; align-items: center; }
    .brand img { width: 64px; height: 64px; object-fit: contain; }
    .brand h1 { font-size: 22px; letter-spacing: 0.3px; }
    .brand p { color: #6B7280; font-size: 12px; line-height: 1.5; }
    .inv-box { text-align: right; }
    .inv-box .title { font-size: 30px; font-weight: 800; letter-spacing: 3px; color: #2563EB; }
    .inv-box .no { font-family: Consolas, monospace; font-size: 15px; font-weight: 700; margin-top: 2px; }
    .inv-box .dates { margin-top: 8px; color: #6B7280; font-size: 12px; line-height: 1.7; }
    .badge { display: inline-block; margin-top: 8px; padding: 4px 14px; border-radius: 999px; font-size: 12px; font-weight: 800; letter-spacing: 1px; color: #fff; background: ${payColor}; }
    .bill { margin-top: 28px; display: flex; justify-content: space-between; gap: 20px; }
    .bill .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #9CA3AF; margin-bottom: 4px; }
    .bill .name { font-size: 16px; font-weight: 700; }
    .bill p { color: #4B5563; font-size: 12px; line-height: 1.6; }
    table { width: 100%; border-collapse: collapse; margin-top: 22px; }
    thead th { background: #F3F4F6; border-bottom: 2px solid #D1D5DB; padding: 9px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: #374151; text-align: left; }
    tbody td { padding: 9px 10px; border-bottom: 1px solid #E5E7EB; }
    .c { text-align: center; } .r { text-align: right; } .muted { color: #9CA3AF; }
    .totals { margin-top: 14px; margin-left: auto; width: 260px; }
    .totals .row { display: flex; justify-content: space-between; padding: 5px 10px; font-size: 13px; }
    .totals .row.grand { border-top: 2px solid #111827; margin-top: 4px; padding-top: 9px; font-size: 16px; font-weight: 800; }
    .totals .row.balance { color: ${balance > 0.005 ? '#DC2626' : '#059669'}; font-weight: 800; }
    .notes { margin-top: 26px; padding: 12px 14px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; color: #4B5563; font-size: 12px; }
    .notes .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #9CA3AF; margin-bottom: 4px; }
    .footer { margin-top: 40px; text-align: center; color: #9CA3AF; font-size: 12px; border-top: 1px solid #E5E7EB; padding-top: 14px; }
    @media print {
        body { padding: 20px; }
        @page { size: A4; margin: 12mm; }
    }
</style>
</head>
<body>
    <div class="top">
        <div class="brand">
            ${store.logo ? `<img src="${esc(store.logo)}" alt="logo">` : ''}
            <div>
                <h1>${esc(store.storeName || 'Store')}</h1>
                <p>
                    ${store.storeAddress ? esc(store.storeAddress) + '<br>' : ''}
                    ${store.phone ? '☎ ' + esc(store.phone) : ''}${store.phone && store.email ? ' · ' : ''}${store.email ? esc(store.email) : ''}
                </p>
            </div>
        </div>
        <div class="inv-box">
            <div class="title">INVOICE</div>
            <div class="no">${esc(inv)}</div>
            <div class="dates">
                Order Date: <strong>${d(order.order_date)}</strong><br>
                ${order.due_date ? `Due Date: <strong>${d(order.due_date)}</strong><br>` : ''}
                ${warehouseName ? `Warehouse: <strong>${esc(warehouseName)}</strong>` : ''}
            </div>
            <div class="badge">${payStatus}</div>
        </div>
    </div>

    <div class="bill">
        <div>
            <div class="label">Bill To</div>
            <div class="name">${esc(order.customer_name || 'Customer')}</div>
            ${order.customer_phone ? `<p>☎ ${esc(order.customer_phone)}</p>` : ''}
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th class="c" style="width:36px">#</th>
                <th>Description</th>
                <th class="c" style="width:60px">Qty</th>
                <th class="r" style="width:100px">Unit Price</th>
                <th class="r" style="width:110px">Amount</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>

    <div class="totals">
        <div class="row"><span>Subtotal</span><span>${fmt(total)}</span></div>
        <div class="row"><span>Paid</span><span>- ${fmt(paid)}</span></div>
        <div class="row grand balance"><span>Balance Due</span><span>${fmt(balance)}</span></div>
    </div>

    ${order.notes ? `<div class="notes"><div class="label">Notes</div>${esc(order.notes)}</div>` : ''}

    <div class="footer">Thank you for your business! · ${esc(store.storeName || '')}</div>
</body>
</html>`;

    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) {
        alert('Popup blocked — please allow popups to print the invoice.');
        return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    // Give fonts and the logo a moment to load before the print dialog opens.
    setTimeout(() => w.print(), 450);
};
