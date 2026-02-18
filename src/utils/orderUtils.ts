
import type { Sale } from '../types';

export const generateOrderCopyText = (order: Sale, sales: Sale[]) => {
    // Calculate daily sequence number based on actual data
    const orderDate = new Date(order.date);
    const orderDateStr = orderDate.toDateString();

    // Get all sales for this date
    const dailyOrders = sales
        .filter(s => new Date(s.date).toDateString() === orderDateStr)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Find index (1-based)
    const dailyIndex = dailyOrders.findIndex(s => s.id === order.id) + 1;
    const sequenceNumber = dailyIndex > 0 ? dailyIndex : '?';

    const lines = [
        `No: ${sequenceNumber}`,
        `Order ID: #${order.id.slice(-6)}`,
        `Date: ${new Date(order.date).toLocaleDateString()}`,
        `Customer: ${order.customer?.name || 'N/A'}`,
        `Phone: ${order.customer?.phone || 'N/A'}`,
        `Address: ${order.customer?.address || 'N/A'}`,
        `Page: ${order.customer?.page || 'N/A'}`,
        `Salesman: ${order.salesman || 'N/A'}`,
        `Shipping: ${order.shipping?.company || 'N/A'}`,
        `Items:`,
        ...order.items.map(i => `- ${i.name} x${i.quantity} ($${i.price})`),
        `Total: $${order.total.toFixed(2)}`,
        `Remark: ${order.remark || ''}`,
        `Link: ${window.location.origin}/orders/${order.id}`
    ];

    return lines.join('\n');
};
