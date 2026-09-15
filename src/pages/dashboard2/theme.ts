// Dashboard2 design tokens (spec §5). Inline styles everywhere in this
// codebase, so tokens live here as constants rather than CSS variables.
import type { CSSProperties } from 'react';

export const D2 = {
    bg: '#f4f6fa',
    card: '#ffffff',
    border: '#e5e7eb',
    radius: 12,
    ink: '#111827',
    muted: '#6b7280',
    blue: '#2563eb', blueBg: '#eff4ff',
    violet: '#6d28d9', violetBg: '#f5f3ff',
    amber: '#b45309', amberBg: '#fff7ed', amberLine: '#f59e0b',
    red: '#b91c1c', redBg: '#fef2f2', redLine: '#ef4444',
    green: '#047857', greenBg: '#ecfdf5', greenLine: '#10b981',
} as const;

// Pipeline / status colours (spec §4.3).
export const STATUS_COLORS: Record<string, string> = {
    Pending: '#f59e0b',
    Confirmed: '#3b82f6',
    Shipped: '#8b5cf6',
    Delivered: '#10b981',
    Cancelled: '#9ca3af',
    Returned: '#ef4444',
    Drafted: '#6b7280',
    ReStock: '#0ea5e9',
};

export const PAY_COLORS: Record<string, string> = {
    Unpaid: '#b45309',
    Deposit: '#6d28d9',
    Paid: '#047857',
    Cancel: '#6b7280',
    'Get File': '#2563eb',
};

// Tier 3 (passive / zero) opacity.
export const PASSIVE_OPACITY = 0.42;

// Numerals align in columns everywhere (spec §5).
export const tabular: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

export const cardStyle: CSSProperties = {
    background: D2.card,
    border: `1px solid ${D2.border}`,
    borderRadius: D2.radius,
    boxShadow: '0 1px 2px rgba(17, 24, 39, 0.04)',
};

// Formatting ----------------------------------------------------------------

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

// null/undefined/NaN render as an em dash, never "$0.00" (spec §8 Partial).
export const fmtMoney = (v: number | null | undefined): string =>
    v === null || v === undefined || !Number.isFinite(v) ? '—' : usd.format(v);

export const fmtPct = (ratio: number | null | undefined, digits = 1): string =>
    ratio === null || ratio === undefined || !Number.isFinite(ratio) ? '—' : `${(ratio * 100).toFixed(digits)}%`;

export const fmtInt = (v: number | null | undefined): string =>
    v === null || v === undefined || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('en-US').format(v);

// "Sep 7" / "Sep 7, 2026" from a YYYY-MM-DD key (parsed as a local day).
export const fmtDay = (key: string, withYear = false): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) return key;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString('en-US', withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
};

// "3h" / "2d 4h" for an age in hours.
export const fmtAge = (hours: number | null): string => {
    if (hours === null || !Number.isFinite(hours) || hours < 0) return '—';
    if (hours < 1) return '<1h';
    if (hours < 24) return `${Math.floor(hours)}h`;
    const d = Math.floor(hours / 24);
    const h = Math.floor(hours % 24);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
};
