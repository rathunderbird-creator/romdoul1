import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Phone, Receipt, FileText, DollarSign, Trash2, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';
import { MiniStatCard } from '../../components/MobileFilterKit';
import type { Supplier } from '../../types';

interface LedgerEntry {
    id: string;
    date: string;
    type: 'Invoice' | 'Payment';
    description: string;
    reference: string;
    invoiceNumber: string;
    paymentMethod: string;
    debt: number;
    paid: number;
    balance: number;
}

const formatCurrency = (val: number) => {
    if (val === 0) return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
};

const SupplierDetailsPage = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();

    const [supplier, setSupplier] = useState<Supplier | null>(null);
    const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
    const [payments, setPayments] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const isMobile = useMobile();
    const [dateStart, setDateStart] = useState('');
    const [dateEnd, setDateEnd] = useState('');

    useEffect(() => {
        if (!supplier) {
            setHeaderContent({
                title: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                        <button 
                            onClick={() => navigate('/procurement/suppliers')}
                            className="hover-highlight"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '8px', display: 'flex', alignItems: 'center', color: 'var(--color-text-secondary)' }}
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Supplier Ledger</h1>
                            <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Loading supplier details...</p>
                        </div>
                    </div>
                )
            });
        }
        return () => setHeaderContent(null);
    }, [setHeaderContent, navigate, supplier]);

    useEffect(() => {
        if (!id) return;

        const fetchData = async () => {
            setIsLoading(true);
            try {
                // Fetch Supplier
                const { data: supData, error: supError } = await supabase
                    .from('suppliers')
                    .select('*')
                    .eq('id', id)
                    .single();
                if (supError) throw supError;
                setSupplier(supData);

                // Update Header once supplier is loaded
                setHeaderContent({
                    title: (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <button 
                                onClick={() => navigate('/procurement/suppliers')}
                                className="hover-highlight"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '8px', display: 'flex', alignItems: 'center', color: 'var(--color-text-secondary)' }}
                            >
                                <ArrowLeft size={20} />
                            </button>
                            <div>
                                <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{supData.name} - Ledger</h1>
                                <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Account statement and payment history</p>
                            </div>
                        </div>
                    )
                });

                // Fetch POs
                const { data: poData, error: poError } = await supabase
                    .from('purchase_orders')
                    .select('*, items:purchase_order_items(*, product:products(name))')
                    .eq('supplier_id', id);
                if (poError) throw poError;
                setPurchaseOrders(poData || []);

                // Fetch Payments
                const { data: payData, error: payError } = await supabase
                    .from('supplier_payments')
                    .select('*, purchase_order:purchase_orders(id)')
                    .eq('supplier_id', id);
                if (payError) throw payError;
                setPayments(payData || []);

            } catch (error: any) {
                console.error("Error fetching supplier ledger:", error);
                showToast("Failed to load supplier details: " + error.message, 'error');
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [id, setHeaderContent, navigate, showToast]);

    const ledger = useMemo(() => {
        let entries: Omit<LedgerEntry, 'balance'>[] = [];

        // Map POs as Debt/Invoices
        purchaseOrders.forEach(po => {
            let desc = '';
            if (po.items && po.items.length > 0) {
                const itemStrs = po.items.map((item: any) => {
                    const prodName = item.product?.name || 'Unknown Product';
                    return `${prodName}=${item.quantity}($${item.unit_price})`;
                });
                desc = `ទិញ ${itemStrs.join(', ')}`;
            } else {
                desc = `Purchase Order #${po.id.slice(0, 8)}`;
            }

            entries.push({
                id: `po-${po.id}`,
                date: po.order_date,
                type: 'Invoice',
                description: desc,
                reference: po.id.slice(0, 8).toUpperCase(),
                invoiceNumber: po.invoice_number || '',
                paymentMethod: '',
                debt: Number(po.total_amount) || 0,
                paid: 0
            });
        });

        // Map Payments as Paid/Returns
        payments.forEach(pay => {
            entries.push({
                id: `pay-${pay.id}`,
                date: pay.payment_date,
                type: 'Payment',
                description: `សង ${pay.amount}$ - ${pay.notes || (pay.purchase_order ? pay.purchase_order.id.slice(0, 8).toUpperCase() : 'General Payment')}`,
                reference: pay.purchase_order ? pay.purchase_order.id.slice(0, 8).toUpperCase() : 'PAYMENT',
                invoiceNumber: '',
                paymentMethod: pay.payment_method || '',
                debt: 0,
                paid: Number(pay.amount) || 0
            });
        });

        // Sort chronologically (oldest first to calculate running balance)
        entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Calculate running balance
        let currentBalance = 0;
        const finalizedLedger: LedgerEntry[] = entries.map(entry => {
            currentBalance += entry.debt;
            currentBalance -= entry.paid;
            return {
                ...entry,
                balance: currentBalance
            };
        });

        // Reverse so newest is first
        return finalizedLedger.reverse();
    }, [purchaseOrders, payments]);

    // Filter by date range
    const filteredLedger = useMemo(() => {
        return ledger.filter(entry => {
            if (dateStart && entry.date < dateStart) return false;
            if (dateEnd && entry.date > dateEnd) return false;
            return true;
        });
    }, [ledger, dateStart, dateEnd]);

    const stats = useMemo(() => {
        const totalDebt = ledger.reduce((sum, entry) => sum + entry.debt, 0);
        const totalPaid = ledger.reduce((sum, entry) => sum + entry.paid, 0);
        const paidPercent = totalDebt > 0 ? Math.min(100, Math.round((totalPaid / totalDebt) * 100)) : 0;
        return {
            totalDebt,
            totalPaid,
            balance: totalDebt - totalPaid,
            paidPercent,
        };
    }, [ledger]);

    // Totals for filtered view
    const filteredTotals = useMemo(() => {
        const totalDebt = filteredLedger.reduce((sum, e) => sum + e.debt, 0);
        const totalPaid = filteredLedger.reduce((sum, e) => sum + e.paid, 0);
        return { totalDebt, totalPaid };
    }, [filteredLedger]);

    const handleDeleteLedgerEntry = async (entry: LedgerEntry) => {
        if (!window.confirm(`Are you sure you want to delete this ${entry.type}? This action cannot be undone.`)) return;
        
        try {
            if (entry.id.startsWith('po-')) {
                const poId = entry.id.replace('po-', '');
                const { error } = await supabase.from('purchase_orders').delete().eq('id', poId);
                if (error) throw error;
                setPurchaseOrders(prev => prev.filter(po => po.id !== poId));
                showToast('Purchase order deleted', 'success');
            } else if (entry.id.startsWith('pay-')) {
                const payId = entry.id.replace('pay-', '');
                
                // Revert PO payment amount
                const { data: payment, error: fetchErr } = await supabase.from('supplier_payments').select('*').eq('id', payId).single();
                if (fetchErr) throw fetchErr;

                if (payment && payment.purchase_order_id) {
                    const { data: po } = await supabase.from('purchase_orders').select('amount_paid, total_amount').eq('id', payment.purchase_order_id).single();
                    if (po) {
                        const newAmountPaid = Math.max(0, (Number(po.amount_paid) || 0) - Number(payment.amount));
                        const newPaymentStatus = newAmountPaid === 0 ? 'Unpaid' : (newAmountPaid >= po.total_amount ? 'Paid' : 'Partial');
                        await supabase.from('purchase_orders').update({
                            amount_paid: newAmountPaid,
                            payment_status: newPaymentStatus
                        }).eq('id', payment.purchase_order_id);
                    }
                }

                const { error } = await supabase.from('supplier_payments').delete().eq('id', payId);
                if (error) throw error;
                
                setPayments(prev => prev.filter(p => p.id !== payId));
                showToast('Payment deleted', 'success');
            }
        } catch (err: any) {
            console.error('Delete error', err);
            showToast('Failed to delete: ' + err.message, 'error');
        }
    };

    if (isLoading) {
        return (
            <div className="page-container fade-in" style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
                <div className="loader"></div>
            </div>
        );
    }

    if (!supplier) {
        return (
            <div className="page-container fade-in">
                <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
                    <h3>Supplier not found</h3>
                    <button className="primary-button" onClick={() => navigate('/procurement/suppliers')} style={{ marginTop: '16px' }}>Back to Suppliers</button>
                </div>
            </div>
        );
    }

    return (
        <div className="page-container fade-in">
            {/* Summary Cards — mobile: supplier strip + 3 compact cards on one row */}
            {isMobile ? (
                <div style={{ marginBottom: '12px' }}>
                    <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '12px', marginBottom: '6px' }}>
                        <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Building2 size={16} />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '14px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{supplier.name}</div>
                            {supplier.phone && <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{supplier.phone}</div>}
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: stats.paidPercent >= 100 ? '#10b981' : '#f59e0b', flexShrink: 0 }}>{stats.paidPercent}% paid</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
                        <MiniStatCard icon={Receipt} gradient="linear-gradient(135deg, #ef4444, #f87171)" label="Invoiced" value={formatCurrency(stats.totalDebt)} valueColor="#ef4444" />
                        <MiniStatCard icon={DollarSign} gradient="linear-gradient(135deg, #10b981, #34d399)" label="Paid" value={formatCurrency(stats.totalPaid)} valueColor="#10b981" />
                        <MiniStatCard icon={DollarSign} gradient="linear-gradient(135deg, #f59e0b, #fbbf24)" label="Outstanding" value={formatCurrency(stats.balance)} valueColor={stats.balance > 0 ? '#ef4444' : '#10b981'} />
                    </div>
                </div>
            ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                {/* Supplier Info Card */}
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '18px 20px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Building2 size={22} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Supplier</div>
                        <div style={{ fontSize: '17px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{supplier.name}</div>
                        {supplier.phone && <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}><Phone size={10} />{supplier.phone}</div>}
                    </div>
                </div>

                {/* Total Invoiced */}
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '18px 20px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #ef4444, #f87171)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Receipt size={22} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Total Invoiced</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#ef4444' }}>{formatCurrency(stats.totalDebt)}</div>
                    </div>
                </div>

                {/* Total Paid */}
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '18px 20px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #10b981, #34d399)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <DollarSign size={22} />
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Total Paid</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981' }}>{formatCurrency(stats.totalPaid)}</div>
                    </div>
                </div>

                {/* Balance with Progress */}
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '18px 20px', background: stats.balance > 0 ? 'rgba(239, 68, 68, 0.03)' : undefined }}>
                    <div style={{ position: 'relative', width: '48px', height: '48px', flexShrink: 0 }}>
                        {/* SVG Progress Ring */}
                        <svg width="48" height="48" viewBox="0 0 48 48" style={{ transform: 'rotate(-90deg)' }}>
                            <circle cx="24" cy="24" r="20" fill="none" stroke="var(--color-border)" strokeWidth="4" />
                            <circle cx="24" cy="24" r="20" fill="none" 
                                stroke={stats.paidPercent >= 100 ? '#10b981' : stats.paidPercent >= 50 ? '#3b82f6' : '#f59e0b'} 
                                strokeWidth="4" 
                                strokeDasharray={`${(stats.paidPercent / 100) * 125.66} 125.66`}
                                strokeLinecap="round"
                            />
                        </svg>
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                            {stats.paidPercent}%
                        </div>
                    </div>
                    <div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Outstanding</div>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: stats.balance > 0 ? '#ef4444' : '#10b981' }}>
                            {formatCurrency(stats.balance)}
                        </div>
                    </div>
                </div>
            </div>
            )}

            {/* Date Range Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '12px', marginBottom: isMobile ? '12px' : '20px', flexWrap: 'wrap' }}>
                {!isMobile && <Calendar size={16} color="var(--color-text-muted)" />}
                {!isMobile && <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary)' }}>Filter by date:</span>}
                <input
                    type="date"
                    value={dateStart}
                    onChange={(e) => setDateStart(e.target.value)}
                    className="input-field"
                    style={{ padding: '7px 12px', borderRadius: '8px', fontSize: '13px', border: '1px solid var(--color-border)', flex: isMobile ? 1 : undefined, minWidth: 0 }}
                />
                <span style={{ color: 'var(--color-text-muted)' }}>→</span>
                <input
                    type="date"
                    value={dateEnd}
                    onChange={(e) => setDateEnd(e.target.value)}
                    className="input-field"
                    style={{ padding: '7px 12px', borderRadius: '8px', fontSize: '13px', border: '1px solid var(--color-border)', flex: isMobile ? 1 : undefined, minWidth: 0 }}
                />
                {(dateStart || dateEnd) && (
                    <button 
                        onClick={() => { setDateStart(''); setDateEnd(''); }}
                        style={{ padding: '6px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '12px', cursor: 'pointer', fontWeight: 500 }}
                    >
                        Clear
                    </button>
                )}
                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                    {filteredLedger.length} entries
                </span>
            </div>

            {/* Mobile: ledger as inbox-style rows with a totals footer */}
            {isMobile ? (
                <div className="glass-panel" style={{ borderRadius: '16px', padding: 0, overflow: 'hidden' }}>
                    {filteredLedger.length === 0 ? (
                        <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                            <FileText size={32} style={{ opacity: 0.4, margin: '0 auto 10px', display: 'block' }} />
                            No transactions found for this supplier.
                        </div>
                    ) : (
                        <>
                            {filteredLedger.map(entry => {
                                const isInvoice = entry.type === 'Invoice';
                                return (
                                    <div key={entry.id} style={{ padding: '10px 12px 10px 14px', borderBottom: '1px solid var(--color-border)', borderLeft: `4px solid ${isInvoice ? '#ef4444' : '#3b82f6'}` }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                                <span style={{ color: isInvoice ? '#ef4444' : '#3b82f6', fontWeight: 700, padding: '2px 9px', background: isInvoice ? 'rgba(239,68,68,0.08)' : 'rgba(59,130,246,0.08)', borderRadius: '12px', fontSize: '11px', flexShrink: 0 }}>
                                                    {isInvoice ? 'ជំពាក់' : 'សង'}
                                                </span>
                                                <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                                                    {new Date(entry.date).toLocaleDateString('en-GB').replace(/\//g, '-')}
                                                </span>
                                            </span>
                                            <span style={{ fontSize: '14px', fontWeight: 800, color: isInvoice ? '#ef4444' : '#3b82f6', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                                                {isInvoice ? formatCurrency(entry.debt) : formatCurrency(entry.paid)}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                            <span style={{ fontSize: '12px', color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                                                {entry.invoiceNumber || (isInvoice ? `PO-${entry.reference}` : '')}{entry.description ? ` · ${entry.description}` : ''}
                                                {entry.paymentMethod ? ` · ${entry.paymentMethod}` : ''}
                                            </span>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                                <span style={{ fontSize: '11px', fontWeight: 700, color: entry.balance > 0 ? '#ef4444' : '#10b981' }}>
                                                    Bal {formatCurrency(entry.balance)}
                                                </span>
                                                <button onClick={() => handleDeleteLedgerEntry(entry)} title="Delete Entry" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', opacity: 0.6, padding: '2px', display: 'flex' }}>
                                                    <Trash2 size={14} />
                                                </button>
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                            {/* Totals */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--color-bg)', fontSize: '12px', fontWeight: 700, flexWrap: 'wrap', gap: '6px' }}>
                                <span style={{ color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '11px' }}>Totals{(dateStart || dateEnd) ? ' (filtered)' : ''}</span>
                                <span style={{ display: 'flex', gap: '10px' }}>
                                    <span style={{ color: '#ef4444' }}>{formatCurrency(filteredTotals.totalDebt)}</span>
                                    <span style={{ color: '#3b82f6' }}>{formatCurrency(filteredTotals.totalPaid)}</span>
                                    <span style={{ color: stats.balance > 0 ? '#ef4444' : '#10b981' }}>= {formatCurrency(stats.balance)}</span>
                                </span>
                            </div>
                        </>
                    )}
                </div>
            ) : (
            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: 'none' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: '14px 20px', fontWeight: 600, fontSize: '12px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px', width: '100px' }}>Date</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, fontSize: '12px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px', width: '100px' }}>Type</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, fontSize: '12px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px', width: '130px' }}>Supplier</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, fontSize: '12px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Description</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, fontSize: '12px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px', width: '110px' }}>Invoice No</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, fontSize: '12px', color: '#ef4444', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right', width: '110px' }}>Debt (ជំពាក់)</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, fontSize: '12px', color: '#3b82f6', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right', width: '110px' }}>Paid (សង)</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, fontSize: '12px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'right', width: '120px' }}>Balance</th>
                            <th style={{ padding: '14px 20px', fontWeight: 600, fontSize: '12px', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', width: '60px' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredLedger.length === 0 ? (
                            <tr>
                                <td colSpan={9} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--color-text-secondary)' }}>
                                        <FileText size={32} style={{ opacity: 0.5 }} />
                                        <p>No transactions found for this supplier.</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            <>
                                {filteredLedger.map((entry, idx) => (
                                    <tr 
                                        key={entry.id} 
                                        style={{ 
                                            borderBottom: '1px solid var(--color-border)', 
                                            transition: 'background-color 0.2s ease',
                                            background: idx % 2 === 1 ? 'rgba(0,0,0,0.015)' : undefined,
                                        }} 
                                        className="hover-highlight"
                                    >
                                        <td style={{ padding: '12px 20px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}>
                                            {new Date(entry.date).toLocaleDateString('en-GB').replace(/\//g, '-')}
                                        </td>
                                        <td style={{ padding: '12px 20px', fontSize: '13px' }}>
                                            {entry.type === 'Invoice' ? (
                                                <span style={{ color: '#ef4444', fontWeight: 600, display: 'inline-flex', padding: '3px 10px', background: 'rgba(239, 68, 68, 0.08)', borderRadius: '20px', fontSize: '12px' }}>ជំពាក់</span>
                                            ) : (
                                                <span style={{ color: '#3b82f6', fontWeight: 600, display: 'inline-flex', padding: '3px 10px', background: 'rgba(59, 130, 246, 0.08)', borderRadius: '20px', fontSize: '12px' }}>សង</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '12px 20px', fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)' }}>
                                            {supplier.name.length > 15 ? supplier.name.substring(0, 15) + '…' : supplier.name}
                                        </td>
                                        <td style={{ padding: '12px 20px', fontSize: '13px', color: 'var(--color-text)' }}>
                                            <div>{entry.description}</div>
                                            {entry.paymentMethod && (
                                                <span style={{ 
                                                    fontSize: '11px', fontWeight: 600, marginTop: '4px', display: 'inline-block',
                                                    padding: '2px 8px', borderRadius: '8px', 
                                                    background: 'rgba(107, 114, 128, 0.08)', color: 'var(--color-text-secondary)',
                                                }}>
                                                    {entry.paymentMethod}
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ padding: '12px 20px', fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500, fontFamily: entry.invoiceNumber ? 'monospace' : undefined }}>
                                            {entry.invoiceNumber || (entry.type === 'Invoice' ? `PO-${entry.reference}` : '—')}
                                        </td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: entry.debt > 0 ? '#ef4444' : 'var(--color-text-muted)' }}>
                                            {entry.debt > 0 ? formatCurrency(entry.debt) : ''}
                                        </td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: entry.paid > 0 ? '#3b82f6' : 'var(--color-text-muted)' }}>
                                            {entry.paid > 0 ? formatCurrency(entry.paid) : ''}
                                        </td>
                                        <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: '14px', fontWeight: 700, color: entry.balance > 0 ? '#ef4444' : '#10b981' }}>
                                            {formatCurrency(entry.balance)}
                                        </td>
                                        <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                                            <button 
                                                onClick={() => handleDeleteLedgerEntry(entry)}
                                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', opacity: 0.5, transition: 'opacity 0.2s' }}
                                                title="Delete Entry"
                                                onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                                                onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.5')}
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {/* Totals Row */}
                                <tr style={{ background: 'rgba(0,0,0,0.03)', borderTop: '2px solid var(--color-border)' }}>
                                    <td colSpan={5} style={{ padding: '14px 20px', fontSize: '13px', fontWeight: 700, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Totals {(dateStart || dateEnd) ? '(filtered)' : ''}
                                    </td>
                                    <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: '15px', fontWeight: 700, color: '#ef4444' }}>
                                        {formatCurrency(filteredTotals.totalDebt)}
                                    </td>
                                    <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: '15px', fontWeight: 700, color: '#3b82f6' }}>
                                        {formatCurrency(filteredTotals.totalPaid)}
                                    </td>
                                    <td style={{ padding: '14px 20px', textAlign: 'right', fontSize: '15px', fontWeight: 700, color: stats.balance > 0 ? '#ef4444' : '#10b981' }}>
                                        {formatCurrency(stats.balance)}
                                    </td>
                                    <td></td>
                                </tr>
                            </>
                        )}
                    </tbody>
                </table>
            </div>
            )}
        </div>
    );
};

export default SupplierDetailsPage;
