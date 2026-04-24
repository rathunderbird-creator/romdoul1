import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { useMobile } from '../hooks/useMobile';

interface StatsCardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    trend?: string;
    color?: string;
    bgColor?: string;
    textColor?: string;
    onClick?: () => void;
    style?: React.CSSProperties;
}

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon: Icon, trend, color = 'var(--color-primary)', bgColor, onClick, style }) => {
    const isMobile = useMobile();

    return (
        <div 
            className={`glass-panel ${onClick ? 'clickable-card' : ''}`} 
            style={{ 
                ...style,
                padding: isMobile ? '12px' : '16px', 
                display: 'flex', 
                flexDirection: 'row', 
                alignItems: 'center',
                gap: '16px', 
                backgroundColor: 'var(--color-surface)', // ensures clean card look
                cursor: onClick ? 'pointer' : 'default',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
            onClick={onClick}
        >
            <div style={{
                padding: isMobile ? '10px' : '12px',
                borderRadius: '12px',
                backgroundColor: bgColor || `color-mix(in srgb, ${color} 15%, transparent)`,
                color: color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
            }}>
                <Icon size={isMobile ? 20 : 24} />
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ color: 'var(--color-text-main)', fontSize: isMobile ? '14px' : '15px', fontWeight: 600 }}>
                    {title}
                </div>
                {trend && (
                    <div style={{ fontSize: isMobile ? '11px' : '12px', marginTop: '2px', color: 'var(--color-text-secondary)', fontWeight: 400 }}>
                        {trend}
                    </div>
                )}
            </div>

            <div style={{ fontSize: isMobile ? '18px' : '20px', fontWeight: 'bold', color: 'var(--color-text-main)' }}>
                {value}
            </div>
        </div>
    );
};

export default StatsCard;
