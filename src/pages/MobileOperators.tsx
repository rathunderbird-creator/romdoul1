import React, { useState } from 'react';
import { Search, Phone, Smartphone, Hash, Navigation as NavIcon } from 'lucide-react';
import { useHeader } from '../context/HeaderContext';

// Operator Data structure based on standard Cambodia prefixes
const OPERATOR_DATA = [
    {
        name: 'Cellcard',
        color: '#F48220', // Cellcard Orange
        bg: 'rgba(244, 130, 32, 0.1)',
        prefixes: ['011', '012', '014', '017', '061', '076', '077', '078', '079', '085', '089', '092', '095', '099']
    },
    {
        name: 'Smart',
        color: '#00A54F', // Smart Green
        bg: 'rgba(0, 165, 79, 0.1)',
        prefixes: ['010', '015', '016', '069', '070', '081', '086', '087', '093', '096', '098']
    },
    {
        name: 'Metfone',
        color: '#E3000F', // Metfone Red
        bg: 'rgba(227, 0, 15, 0.1)',
        prefixes: ['031', '060', '066', '067', '068', '071', '088', '090', '097']
    },
    {
        name: 'Seatel',
        color: '#0059A6', // Seatel Blue
        bg: 'rgba(0, 89, 166, 0.1)',
        prefixes: ['018', '0189']
    }
];

const MobileOperators: React.FC = () => {
    const { setHeaderContent } = useHeader();
    const [searchTerm, setSearchTerm] = useState('');

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Phone size={20} />
                    <span className="font-semibold text-color-text-main" style={{ fontSize: '18px' }}>Mobile Operators</span>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    // Format utility for easy reading
    const formatPrefixes = (prefixes: string[]) => {
        return prefixes.map(p => {
            const label = p.length === 4 ? `${p} (+ 6 digits)` : `${p} (+ 6 or 7 digits)`;
            return { raw: p, label };
        });
    };

    // Filter by search
    const filteredOperators = OPERATOR_DATA.map(op => {
        const matchingPrefixes = op.prefixes.filter(p => p.includes(searchTerm));
        const matchesName = op.name.toLowerCase().includes(searchTerm.toLowerCase());

        if (matchesName) return op; // Return all prefixes if name matches
        if (matchingPrefixes.length > 0) return { ...op, prefixes: matchingPrefixes }; // Return only matched prefixes
        return null;
    }).filter((op): op is { name: string; color: string; bg: string; prefixes: string[] } => op !== null);

    return (
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            {/* Header & Search */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>Telecom Operators</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>Discover mobile network prefixes in Cambodia</p>
                </div>

                <div style={{ position: 'relative', width: '300px' }}>
                    <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)' }} />
                    <input
                        type="text"
                        placeholder="Search by prefix (e.g., 012) or operator..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '12px 16px 12px 40px',
                            borderRadius: '12px',
                            border: '1px solid var(--color-border)',
                            background: 'var(--color-surface)',
                            color: 'var(--color-text-main)',
                            fontSize: '14px',
                            outline: 'none',
                            transition: 'all 0.2s ease',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                        }}
                    />
                </div>
            </div>

            {/* Operator Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
                {filteredOperators.length > 0 ? filteredOperators.map((operator, i) => (
                    <div key={i} style={{
                        background: 'var(--color-surface)',
                        borderRadius: '16px',
                        overflow: 'hidden',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
                        border: '1px solid var(--color-border)',
                        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                        cursor: 'default'
                    }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-4px)';
                            e.currentTarget.style.boxShadow = '0 12px 24px rgba(0,0,0,0.08)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.04)';
                        }}
                    >
                        {/* Card Header */}
                        <div style={{
                            padding: '24px',
                            borderBottom: '1px solid var(--color-border)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '16px',
                            background: operator.bg
                        }}>
                            <div style={{
                                width: '48px', height: '48px',
                                borderRadius: '12px',
                                background: 'white',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                            }}>
                                <Smartphone size={24} color={operator.color} />
                            </div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--color-text-main)' }}>{operator.name}</h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', opacity: 0.8 }}>
                                    <Hash size={14} color={operator.color} />
                                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                        {operator.prefixes.length} {operator.prefixes.length === 1 ? 'Prefix' : 'Prefixes'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Card Body - Prefix List */}
                        <div style={{ padding: '24px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {formatPrefixes(operator.prefixes).map((prefix, j) => (
                                    <div key={j} style={{
                                        padding: '6px 12px',
                                        borderRadius: '8px',
                                        background: 'var(--color-background)',
                                        border: '1px solid var(--color-border)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        fontSize: '14px',
                                        fontWeight: 600,
                                        color: 'var(--color-text-main)'
                                    }}>
                                        <span style={{ color: operator.color }}>{prefix.raw}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )) : (
                    <div style={{ gridColumn: '1 / -1', padding: '64px', textAlign: 'center', background: 'var(--color-surface)', borderRadius: '16px', border: '1px dashed var(--color-border)' }}>
                        <Phone size={48} color="var(--color-text-secondary)" style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                        <h3 style={{ fontSize: '18px', fontWeight: 500, color: 'var(--color-text-main)', marginBottom: '8px' }}>No matches found</h3>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>We couldn't find any operator or prefix matching "{searchTerm}".</p>
                    </div>
                )}
            </div>

            {/* Footer Source */}
            <div style={{ marginTop: '32px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <NavIcon size={14} />
                <span>Reference data sourced from Telecommunication Regulator of Cambodia (TRC) public listings.</span>
            </div>
        </div>
    );
};

export default MobileOperators;
