import { Banknote, Landmark, type LucideIcon } from 'lucide-react';

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

// A CSS-drawn (SVG) icon in place of the raster PAYMENT_LOGOS images — scales
// cleanly at any size and recolors with getPaymentColor via its `color` prop,
// where the PNGs could only ever render at their own baked-in color.
export const getPaymentIcon = (payBy: string | null | undefined): LucideIcon | null => {
    if (!payBy) return null;
    const normalized = payBy.toLowerCase().trim();

    if (normalized.includes('cash') || normalized.includes('cod')) {
        return Banknote;
    }

    if (normalized.includes('bank') || normalized.includes('aba') || normalized.includes('acleda') || normalized.includes('transfer') || normalized.includes('qr') || normalized.includes('card')) {
        return Landmark;
    }

    return null;
};

export const getPaymentColor = (payBy: string | null | undefined): string => {
    if (!payBy) return 'var(--color-text-main)';
    const normalized = payBy.toLowerCase().trim();
    
    if (normalized.includes('cash') || normalized.includes('cod')) {
        return '#16A34A'; // Green
    }
    
    if (normalized.includes('bank') || normalized.includes('aba') || normalized.includes('acleda') || normalized.includes('transfer') || normalized.includes('qr') || normalized.includes('card')) {
        return '#2563EB'; // Blue
    }
    
    return 'var(--color-text-main)';
};
