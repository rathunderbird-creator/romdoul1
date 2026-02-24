export const generateLogoUri = (color: string, text: string) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="4" fill="${color}"/><text x="20" y="26" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="${text.length > 2 ? '14' : '20'}" fill="white" text-anchor="middle">${text}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

export const OPERATOR_DATA = [
    {
        name: 'Cellcard',
        color: '#F48220', // Cellcard Orange
        bg: 'rgba(244, 130, 32, 0.1)',
        logo: generateLogoUri('#F48220', 'CEL'),
        prefixes: ['011', '012', '014', '017', '061', '076', '077', '078', '079', '085', '089', '092', '095', '099']
    },
    {
        name: 'Smart',
        color: '#00A54F', // Smart Green
        bg: 'rgba(0, 165, 79, 0.1)',
        logo: generateLogoUri('#00A54F', 'SMT'),
        prefixes: ['010', '015', '016', '069', '070', '081', '086', '087', '093', '096', '098']
    },
    {
        name: 'Metfone',
        color: '#E3000F', // Metfone Red
        bg: 'rgba(227, 0, 15, 0.1)',
        logo: generateLogoUri('#E3000F', 'MET'),
        prefixes: ['031', '060', '066', '067', '068', '071', '088', '090', '097']
    },
    {
        name: 'Seatel',
        color: '#0059A6', // Seatel Blue
        bg: 'rgba(0, 89, 166, 0.1)',
        logo: generateLogoUri('#0059A6', 'yes'),
        prefixes: ['018', '0189']
    }
];

export const getOperatorForPhone = (phone: string | null | undefined) => {
    if (!phone) return null;

    // Remove all non-digits
    const cleanPhone = phone.replace(/\D/g, '');

    // Check for each prefix (longest first to avoid overlap)
    // Cambodia numbers often start with 0, but sometimes +855, or just 855.
    // If it starts with 855, replace with 0.
    const normalizedPhone = cleanPhone.startsWith('855')
        ? '0' + cleanPhone.substring(3)
        : cleanPhone;

    if (!normalizedPhone.startsWith('0')) return null;

    // Check operators
    for (const operator of OPERATOR_DATA) {
        // Sort prefixes by length descending so that '0189' is checked before '018'
        const sortedPrefixes = [...operator.prefixes].sort((a, b) => b.length - a.length);

        for (const prefix of sortedPrefixes) {
            if (normalizedPhone.startsWith(prefix)) {
                return operator;
            }
        }
    }

    return null;
};
