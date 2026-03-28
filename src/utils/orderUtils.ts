import type { Sale } from '../types';

export const calculateDailySequence = (currentOrder: Sale, allSales: Sale[]) => {
    const orderDate = new Date(currentOrder.date).toDateString();
    const daySales = allSales
        .filter(s => new Date(s.date).toDateString() === orderDate)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    const index = daySales.findIndex(s => s.id === currentOrder.id);
    return index >= 0 ? index + 1 : daySales.length + 1;
};

export const generateOrderCopyText = (order: Sale, allSales: Sale[]) => {
    const sequenceNumber = calculateDailySequence(order, allSales);
    const lines = [
        `🚀 Order Information`,
        ``,
        `#️⃣ Order No: ${String(sequenceNumber).padStart(2, '0')}`,
        `👤 Customer: ${order.customer?.name || 'N/A'}`,
        `📞 Phone: ${order.customer?.phone || 'N/A'}`,
        `📄 Page: ${order.customer?.page || 'N/A'}`,
        `📍 Address: ${order.customer?.address || 'N/A'}`,
        ``,
        `📦 Items:`,
        ...order.items.map(item => `- ${item.name} x${item.quantity} ($${(item.price * item.quantity).toFixed(2)})`),
        ``,
        `💰 Total: $${order.total.toFixed(2)}`,
        `🚚 Shipping: ${order.shipping?.company || 'N/A'}`,
        `👤 Salesman: ${order.salesman || 'N/A'}`,
        `📝 Remark: ${order.remark || 'None'}`,
        `-------------------------`
    ];

    return lines.join('\n');
};
