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

export const getShippingCoColor = (co: string) => {
    if (!co) return 'var(--color-text-main)';
    const normalized = co.toLowerCase().trim();
    
    if (normalized.includes('j&t')) return '#DC2626'; // J&T Red
    if (normalized.includes('js')) return '#1E3A8A'; // JS Dark Blue
    if (normalized.includes('vet')) return '#EA580C'; // VET Orange
    if (normalized.includes('d2d')) return '#2563EB'; // D2D Blue
    if (normalized.includes('toro')) return '#DC2626'; // Toro Red
    if (normalized.includes('អ្នកដឹក')) return '#4B5563'; // Gray
    if (normalized.includes('បុគ្គលិកហាង')) return '#4B5563'; // Gray
    if (normalized.includes('grab')) return '#16A34A'; // Grab Green
    
    return 'var(--color-text-main)';
};
