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
    onClick?: () => void;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon: Icon, trend, color = 'var(--color-primary)', bgColor, textColor, onClick }) => {
    return (
        <div 
            className={`glass-panel ${onClick ? 'clickable-card' : ''}`} 
            style={{ 
                padding: '12px 14px', 
                display: 'flex', 
                flexDirection: 'column', 
                gap: '4px', 
                backgroundColor: bgColor,
                cursor: onClick ? 'pointer' : 'default',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
            onClick={onClick}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <div style={{ color: textColor || 'var(--color-text-secondary)', fontSize: '12px', marginBottom: '2px', fontWeight: textColor ? 600 : 'normal' }}>{title}</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold', color: textColor || 'var(--color-text-main)' }}>{value}</div>
                </div>
                <div style={{
                    padding: '6px',
                    borderRadius: '6px',
                    backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
                    color: color
                }}>
                    <Icon size={16} />
                </div>
            </div>
            {trend && (
                <div style={{ fontSize: '11px', marginTop: '2px', color: textColor || 'var(--color-text-muted)', fontWeight: textColor ? 500 : 'normal', opacity: textColor ? 0.9 : 1 }}>
                    {trend}
                </div>
            )}
        </div>
    );
};

export default StatsCard;
