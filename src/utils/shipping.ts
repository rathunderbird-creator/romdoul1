export const SHIPPING_LOGOS: Record<string, string> = {
    'd2d': '/media/shipping/d2dexpress.png',
    'grab': '/media/shipping/grabexpress.png',
    'j&t': '/media/shipping/jntexpress.png',
    'js': '/media/shipping/jsexpress.jpg',
    'js express': '/media/shipping/jsexpress.jpg',
    'toro': '/media/shipping/toroexpress.png',
    'vet': '/media/shipping/vetexpress.png'
};

export const getShippingLogo = (shippingCo: string | null | undefined): string | null => {
    if (!shippingCo) return null;
    const normalized = shippingCo.toLowerCase().trim();
    
    // Check if the exact or partial string matches any known key
    for (const [key, logo] of Object.entries(SHIPPING_LOGOS)) {
        if (normalized.includes(key)) {
            return logo;
        }
    }
    return null;
};
