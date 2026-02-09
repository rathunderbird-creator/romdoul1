import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface StatsCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    trend?: string;
    color?: string;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon: Icon, trend, color = 'var(--color-primary)' }) => {
    return (
        <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: '13px', marginBottom: '4px' }}>{title}</div>
                    <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'var(--color-text-main)' }}>{value}</div>
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
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                    {trend}
                </div>
            )}
        </div>
    );
};

export default StatsCard;
