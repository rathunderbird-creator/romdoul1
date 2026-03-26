
import type { Sale } from '../types';

export const generateOrderCopyText = (order: Sale) => {
    const lines = [
        `🚀 Order Information`,
        ``,
        `#️⃣ Order No: ${String(order.dailyNumber || 0).padStart(2, '0')}`,
        `👤 Customer: ${order.customer?.name || 'N/A'}`,
        `📞 Phone: ${order.customer?.phone || 'N/A'}`,
        `📄 Page: ${order.customer?.page || 'N/A'}`,
        `📍 Address: ${order.customer?.address || 'N/A'}`,
        ``,
        `📦 Items:`,
        ...order.items.map(i => `- ${i.name} x${i.quantity} ($${i.price.toFixed(2)})`),
        ``,
        `💰 Total: $${order.total.toFixed(2)}`,
        `🚚 Shipping: ${order.shipping?.company || 'N/A'}`,
        `👤 Salesman: ${order.salesman || 'N/A'}`,
        `📝 Remark: ${order.remark || 'None'}`
    ];

    return lines.join('\n');
};
