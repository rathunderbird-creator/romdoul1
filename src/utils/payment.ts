export const PAYMENT_LOGOS: Record<string, string> = {
    'bank': '/media/payby/bank.png',
    'aba': '/media/payby/bank.png',
    'acleda': '/media/payby/bank.png',
    'transfer': '/media/payby/bank.png',
    'qr': '/media/payby/bank.png',
    'card': '/media/payby/bank.png',
    'cash': '/media/payby/cash.png',
    'cod': '/media/payby/cash.png'
};

export const getPaymentLogo = (payBy: string | null | undefined): string | null => {
    if (!payBy) return null;
    const normalized = payBy.toLowerCase().trim();
    
    // Check if the exact or partial string matches any known key
    for (const [key, logo] of Object.entries(PAYMENT_LOGOS)) {
        if (normalized.includes(key)) {
            return logo;
        }
    }
    return null;
};
