/**
 * Sends a notification to a Telegram group when a new order is confirmed.
 */
export const sendTelegramOrderNotification = async (
    botToken: string,
    chatIds: string,
    order: any,
    sequenceNumber: number
) => {
    if (!botToken || !chatIds) return;

    const idList = chatIds.split(',').map(id => id.trim()).filter(id => id.length > 0);
    if (idList.length === 0) return;

    try {
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

        // Simple HTML escaping
        const escapeHtml = (text: string) => (text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const htmlMessage = `
🚀 <b>Order Information</b>

#️⃣ <b>Order No:</b> ${String(sequenceNumber).padStart(2, '0')}
👤 <b>Customer:</b> ${escapeHtml(order.customer?.name || 'Unknown')}
📞 <b>Phone:</b> ${escapeHtml(order.customer?.phone || 'N/A')}
📄 <b>Page:</b> ${escapeHtml(order.customer?.page || 'N/A')}
📍 <b>Address:</b> ${escapeHtml(order.customer?.address || 'N/A')}

📦 <b>Items:</b>
${order.items.map((item: any) => `- ${escapeHtml(item.name)} x${item.quantity} (<b>$${(item.price * item.quantity).toFixed(2)}</b>)`).join('\n')}

💰 <b>Total:</b> <b>$${order.total.toFixed(2)}</b>
🚚 <b>Shipping:</b> ${escapeHtml(order.shipping?.company || 'N/A')}
👤 <b>Salesman:</b> ${escapeHtml(order.salesman || 'N/A')}
📝 <b>Remark:</b> ${escapeHtml(order.remark || 'None')}
-------------------------
`.trim();
        
        const results = [];
        for (const chatId of idList) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: htmlMessage,
                        parse_mode: 'HTML',
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    results.push({ status: 'rejected', reason: new Error(`${chatId}: ${errorData.description || 'Failed'}`) });
                } else {
                    results.push({ status: 'fulfilled', value: undefined });
                }
            } catch (err: any) {
                results.push({ status: 'rejected', reason: new Error(`${chatId}: ${err.message || 'Network Error'}`) });
            }
            // Add a small delay between sends to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const failures = results.filter((r): r is any => r.status === 'rejected');
        if (failures.length > 0) {
            const errorMsg = failures.map(f => f.reason.message).join(', ');
            throw new Error(`Failed for some groups: ${errorMsg}`);
        }
    } catch (error) {
        console.error('Failed to send Telegram notification:', error);
        throw error;
    }
};

/**
 * Sends a test message to verify Telegram configuration.
 */
export const sendTelegramTestMessage = async (botToken: string, chatIds: string) => {
    const idList = chatIds.split(',').map(id => id.trim()).filter(id => id.length > 0);
    if (idList.length === 0) throw new Error('No Chat IDs provided');

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const results = [];
    for (const chatId of idList) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: '<b>✅ Telegram Notification Test</b>\nYour POS system is now connected to this group!',
                    parse_mode: 'HTML',
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                results.push({ status: 'rejected', reason: new Error(`${chatId}: ${errorData.description || 'Failed'}`) });
            } else {
                results.push({ status: 'fulfilled', value: undefined });
            }
        } catch (err: any) {
            results.push({ status: 'rejected', reason: new Error(`${chatId}: ${err.message || 'Network Error'}`) });
        }
        // Add a small delay between sends
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    const failures = results.filter((r): r is any => r.status === 'rejected');
    if (failures.length > 0) {
        const errorMsg = failures.map(f => f.reason.message).join(', ');
        throw new Error(`Failed for some groups: ${errorMsg}`);
    }

    return true;
};
