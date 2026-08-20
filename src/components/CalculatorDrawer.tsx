import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Calculator, X, Copy, Check, Trash2 } from 'lucide-react';

interface CalcHistoryEntry {
    id: string;
    expr: string;
    result: string;
}

interface CalculatorDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    isMobile: boolean;
}

// Safe expression evaluator: numbers (with optional %), + − × ÷, with
// × ÷ precedence and a leading unary minus. No eval().
const evaluate = (expr: string): number | null => {
    const tokens = expr.match(/\d+\.?\d*%?|[+\-×÷]/g);
    if (!tokens || tokens.length === 0) return null;
    const vals: number[] = [];
    const ops: string[] = [];
    let expectNum = true;
    let sign = 1;
    for (const t of tokens) {
        if (t === '+' || t === '-' || t === '×' || t === '÷') {
            if (expectNum) {
                if (t === '-') { sign = -sign; continue; }
                return null;
            }
            ops.push(t);
            expectNum = true;
        } else {
            const v = t.endsWith('%') ? parseFloat(t.slice(0, -1)) / 100 : parseFloat(t);
            if (isNaN(v)) return null;
            vals.push(sign * v);
            sign = 1;
            expectNum = false;
        }
    }
    if (expectNum || vals.length !== ops.length + 1) return null;
    // First pass: × and ÷
    const vs = [vals[0]];
    const rest: string[] = [];
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const v = vals[i + 1];
        if (op === '×') vs[vs.length - 1] *= v;
        else if (op === '÷') {
            if (v === 0) return null;
            vs[vs.length - 1] /= v;
        } else {
            rest.push(op);
            vs.push(v);
        }
    }
    let result = vs[0];
    for (let i = 0; i < rest.length; i++) result = rest[i] === '+' ? result + vs[i + 1] : result - vs[i + 1];
    return result;
};

const formatResult = (n: number): string => {
    if (!isFinite(n)) return 'Error';
    return String(Math.round(n * 1e10) / 1e10);
};

const HISTORY_KEY = 'header_calc_history';

const CalculatorDrawer: React.FC<CalculatorDrawerProps> = ({ isOpen, onClose, isMobile }) => {
    const [expr, setExpr] = useState('');
    const [history, setHistory] = useState<CalcHistoryEntry[]>(() => {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
    });
    const [copiedId, setCopiedId] = useState<string | null>(null);

    useEffect(() => {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
    }, [history]);

    const lastNumberSegment = (s: string) => {
        const m = s.match(/(\d+\.?\d*%?)$/);
        return m ? m[1] : '';
    };

    const press = (key: string) => {
        setExpr(prev => {
            const last = prev.slice(-1);
            if (/\d/.test(key)) {
                if (last === '%') return prev; // a number can't follow % directly
                return prev + key;
            }
            if (key === '.') {
                if (lastNumberSegment(prev).includes('.') || last === '%') return prev;
                if (!/\d/.test(last)) return prev + '0.';
                return prev + '.';
            }
            if (key === '%') {
                return /\d/.test(last) ? prev + '%' : prev;
            }
            if (key === '+' || key === '-' || key === '×' || key === '÷') {
                if (prev === '') return key === '-' ? '-' : prev;
                if ('+-×÷'.includes(last)) return prev.slice(0, -1) + key;
                return prev + key;
            }
            if (key === '⌫') return prev.slice(0, -1);
            if (key === 'C') return '';
            return prev;
        });
    };

    const equals = () => {
        const value = evaluate(expr);
        if (value === null) return;
        const result = formatResult(value);
        // Only record real calculations (an operator was involved).
        if (/[+×÷]|\d-/.test(expr)) {
            setHistory(prev => [{ id: Date.now().toString(), expr, result }, ...prev].slice(0, 20));
        }
        setExpr(result);
    };

    // Live preview while typing.
    const previewValue = /[+×÷]|\d-/.test(expr) ? evaluate(expr) : null;
    const preview = previewValue !== null ? formatResult(previewValue) : '';

    const copyText = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 1200);
        } catch (e) {
            console.error('Copy failed:', e);
        }
    };

    // Physical keyboard support while the drawer is open.
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
            if (/^\d$/.test(e.key)) press(e.key);
            else if (e.key === '.') press('.');
            else if (e.key === '+') press('+');
            else if (e.key === '-') press('-');
            else if (e.key === '*') press('×');
            else if (e.key === '/') { e.preventDefault(); press('÷'); }
            else if (e.key === '%') press('%');
            else if (e.key === 'Backspace') press('⌫');
            else if (e.key === 'Enter' || e.key === '=') equals();
            else if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, expr]);

    const keyBtn = (label: string, opts?: { accent?: boolean; danger?: boolean; onClick?: () => void }) => (
        <button
            key={label}
            onClick={opts?.onClick || (() => press(label))}
            style={{
                padding: '13px 0',
                borderRadius: '12px',
                border: '1px solid var(--color-border)',
                background: opts?.accent ? 'linear-gradient(135deg, #6366F1, #4F46E5)' : opts?.danger ? 'rgba(239,68,68,0.08)' : 'var(--color-bg)',
                color: opts?.accent ? 'white' : opts?.danger ? '#DC2626' : 'var(--color-text-main)',
                fontSize: '17px',
                fontWeight: 700,
                cursor: 'pointer',
                userSelect: 'none',
                transition: 'transform 0.05s',
            }}
            onMouseDown={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)'; }}
            onMouseUp={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
        >
            {label}
        </button>
    );

    return ReactDOM.createPortal(
        <>
            {isOpen && (
                <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1198 }} />
            )}
            <div style={{
                position: 'fixed', top: 0, right: 0, bottom: 0,
                width: isMobile ? '85%' : '360px', maxWidth: '360px', zIndex: 1199,
                display: 'flex', flexDirection: 'column',
                background: 'var(--color-surface)',
                transform: isOpen ? 'translateX(0)' : 'translateX(105%)',
                transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                boxShadow: '-8px 0 30px rgba(0,0,0,0.18)',
                borderRadius: '16px 0 0 16px',
            }}>
                {/* Header */}
                <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #6366F1, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                            <Calculator size={18} />
                        </div>
                        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Calculator</h3>
                    </div>
                    <button onClick={onClose} style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: 'var(--color-text-muted)', width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Display */}
                <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '14px', padding: '12px 14px', textAlign: 'right' }}>
                        <div style={{ fontSize: '24px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-all', minHeight: '30px', color: 'var(--color-text-main)' }}>
                            {expr || '0'}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', minHeight: '22px' }}>
                            <span style={{ fontSize: '14px', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                                {preview ? `= ${preview}` : ''}
                            </span>
                            {(preview || (expr && !isNaN(Number(expr)))) && (
                                <button
                                    onClick={() => copyText(preview || expr, 'display')}
                                    title="Copy result"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: copiedId === 'display' ? '#10B981' : 'var(--color-text-muted)', display: 'flex', padding: '2px' }}
                                >
                                    {copiedId === 'display' ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Keypad */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '12px' }}>
                        {keyBtn('C', { danger: true })}
                        {keyBtn('⌫', { danger: true })}
                        {keyBtn('%')}
                        {keyBtn('÷', { accent: true })}
                        {keyBtn('7')}{keyBtn('8')}{keyBtn('9')}
                        {keyBtn('×', { accent: true })}
                        {keyBtn('4')}{keyBtn('5')}{keyBtn('6')}
                        {keyBtn('-', { accent: true })}
                        {keyBtn('1')}{keyBtn('2')}{keyBtn('3')}
                        {keyBtn('+', { accent: true })}
                        {keyBtn('00')}
                        {keyBtn('0')}
                        {keyBtn('.')}
                        {keyBtn('=', { accent: true, onClick: equals })}
                    </div>
                </div>

                {/* History */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px 6px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--color-text-secondary)' }}>History</span>
                        {history.length > 0 && (
                            <button onClick={() => setHistory([])} title="Clear history" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600 }}>
                                <Trash2 size={12} /> Clear
                            </button>
                        )}
                    </div>
                    {history.length === 0 ? (
                        <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '12px' }}>
                            No calculations yet
                        </div>
                    ) : (
                        history.map(h => (
                            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', borderBottom: '1px solid var(--color-border)' }}>
                                {/* Tap to reuse the result as the new starting value */}
                                <button
                                    onClick={() => setExpr(h.result)}
                                    title="Use this result"
                                    style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'right', padding: 0 }}
                                >
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.expr}</div>
                                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--color-text-main)', fontVariantNumeric: 'tabular-nums' }}>= {h.result}</div>
                                </button>
                                <button
                                    onClick={() => copyText(h.result, h.id)}
                                    title="Copy result"
                                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', cursor: 'pointer', color: copiedId === h.id ? '#10B981' : 'var(--color-text-muted)', width: '28px', height: '28px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                                >
                                    {copiedId === h.id ? <Check size={13} /> : <Copy size={13} />}
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </>,
        document.body
    );
};

export default CalculatorDrawer;
