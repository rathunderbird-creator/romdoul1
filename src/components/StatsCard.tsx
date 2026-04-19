import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface StatsCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    trend?: string;
    color?: string;
    bgColor?: string;
    textColor?: string;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon: Icon, trend, color = 'var(--color-primary)', bgColor, textColor }) => {
    return (
        <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', backgroundColor: bgColor }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ color: textColor || 'var(--color-text-secondary)', fontSize: '13px', marginBottom: '4px', fontWeight: textColor ? 600 : 'normal' }}>{title}</div>
                    <div style={{ fontSize: '22px', fontWeight: 'bold', color: textColor || 'var(--color-text-main)' }}>{value}</div>
                </div>
                <div style={{
                    padding: '8px',
                    borderRadius: '8px',
                    backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
                    color: color
                }}>
                    <Icon size={18} />
                </div>
            </div>
            {trend && (
                <div style={{ fontSize: '12px', color: textColor || 'var(--color-text-muted)', fontWeight: textColor ? 500 : 'normal', opacity: textColor ? 0.9 : 1 }}>
                    {trend}
                </div>
            )}
        </div>
    );
};

export default StatsCard;
