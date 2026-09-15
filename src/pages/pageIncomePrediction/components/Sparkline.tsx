import React, { useId } from 'react';

// Micro area chart of one value per day. The gradient id comes from useId()
// so two sparklines on one screen never share (and clobber) a <defs> entry.
const Sparkline: React.FC<{ values: number[]; color?: string; width?: number; height?: number }> = ({ values, color = '#8B5CF6', width = 120, height = 32 }) => {
    const gradientId = useId();
    if (values.length === 0) return null;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;
    const step = width / (values.length - 1 || 1);
    const points = values.map((v, i) => `${(i * step).toFixed(2)},${(height - ((v - min) / range) * height).toFixed(2)}`).join(' ');
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }} aria-hidden>
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${gradientId})`} />
            <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
};

export default Sparkline;
