import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Phone, Receipt, FileText, DollarSign, Wallet , Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import type { Supplier } from '../../types';

interface LedgerEntry {
    id: string;
    date: string;
    type: 'Invoice' | 'Payment';
    description: string;
    reference: string;
    debt: number;
    paid: number;
    balance: number;
}

const SupplierDetailsPage = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();

    const [supplier, setSupplier] = useState<Supplier | null>(null);
    const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
    const [payments, setPayments] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

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
            // Create a description summarizing the items
            let desc = '';
            if (po.items && po.items.length > 0) {
                const itemStrs = po.items.map((item: any) => {
                    const prodName = item.product?.name || 'Unknown Product';
                    return `${prodName}=${item.quantity}($${item.unit_price})`;
                });
                desc = `ទិញ ${itemStrs.join(', ')}`; // 'ទិញ' = Buy
            } else {
                desc = `Purchase Order #${po.id.slice(0, 8)}`;
            }

            entries.push({
                id: `po-${po.id}`,
                date: po.order_date,
                type: 'Invoice', // ជំពាក់
                description: desc,
                reference: po.id.slice(0, 8).toUpperCase(),
                debt: Number(po.total_amount) || 0,
                paid: 0
            });
        });

        // Map Payments as Paid/Returns
        payments.forEach(pay => {
            entries.push({
                id: `pay-${pay.id}`,
                date: pay.payment_date,
                type: 'Payment', // សង
                description: `សង ${pay.amount}$ - ${pay.notes || (pay.purchase_order ? pay.purchase_order.id.slice(0, 8).toUpperCase() : 'General Payment')}`, // 'សង' = Pay
                reference: pay.purchase_order ? pay.purchase_order.id.slice(0, 8).toUpperCase() : 'PAYMENT',
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

        // The user might want to see newest first, so we reverse it AFTER calculating the balance
        return finalizedLedger.reverse();
    }, [purchaseOrders, payments]);

    const stats = useMemo(() => {
        const totalDebt = ledger.reduce((sum, entry) => sum + entry.debt, 0);
        const totalPaid = ledger.reduce((sum, entry) => sum + entry.paid, 0);
        return {
            totalDebt,
            totalPaid,
            balance: totalDebt - totalPaid
        };
    }, [ledger]);

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

    const formatCurrency = (val: number) => {
        if (val === 0) return '$0.00';
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
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
            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Building2 size={24} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Supplier Info</div>
                        <div style={{ fontSize: '18px', fontWeight: 700 }}>{supplier.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', display: 'flex', gap: '10px', marginTop: '4px' }}>
                            {supplier.phone && <span><Phone size={10} style={{display: 'inline', marginRight: '2px'}}/>{supplier.phone}</span>}
                        </div>
                    </div>
                </div>

                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Receipt size={24} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Total Invoiced (Debt)</div>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-danger)' }}>{formatCurrency(stats.totalDebt)}</div>
                    </div>
                </div>

                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <DollarSign size={24} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Total Paid</div>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--color-success)' }}>{formatCurrency(stats.totalPaid)}</div>
                    </div>
                </div>

                <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '16px', background: stats.balance > 0 ? 'rgba(239, 68, 68, 0.03)' : 'var(--color-bg)' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: stats.balance > 0 ? 'var(--color-danger)' : 'var(--color-success)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Wallet size={24} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>Current Balance (Owed)</div>
                        <div style={{ fontSize: '24px', fontWeight: 700, color: stats.balance > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                            {formatCurrency(stats.balance)}
                        </div>
                    </div>
                </div>
            </div>

            {/* Ledger Table */}
            <div className="glass-panel" style={{ overflowX: 'auto', borderRadius: '16px', padding: '0' }}>
                <table className="spreadsheet-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', border: 'none' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)' }}>
                            <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', width: '100px' }}>Date</th>
                            <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', width: '120px' }}>ប្រតិបត្តិការ (Type)</th>
                            <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', width: '140px' }}>ម្ចាស់លុយ (Supplier)</th>
                            <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>ពិពណ៌នា (Description)</th>
                            <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', width: '120px' }}>Invoice No</th>
                            <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--color-danger)', borderBottom: '1px solid var(--color-border)', textAlign: 'right', width: '100px' }}>ជំពាក់ (Debt)</th>
                            <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--color-primary)', borderBottom: '1px solid var(--color-border)', textAlign: 'right', width: '100px' }}>សង (Paid)</th>
                            <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textAlign: 'right', width: '120px' }}>Clear Invoice</th>
                            <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', textAlign: 'right', width: '80px' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ledger.length === 0 ? (
                            <tr>
                                <td colSpan={9} style={{ padding: '60px 20px', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', color: 'var(--color-text-secondary)' }}>
                                        <FileText size={32} style={{ opacity: 0.5 }} />
                                        <p>No transactions found for this supplier.</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            ledger.map((entry) => (
                                <tr key={entry.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.2s ease' }} className="hover-highlight">
                                    <td style={{ padding: '12px 20px', fontSize: '13px', fontWeight: 500, color: 'var(--color-text)' }}>
                                        {new Date(entry.date).toLocaleDateString('en-GB').replace(/\//g, '-')}
                                    </td>
                                    <td style={{ padding: '12px 20px', fontSize: '13px' }}>
                                        {entry.type === 'Invoice' ? (
                                            <span style={{ color: 'var(--color-danger)', fontWeight: 600, display: 'inline-flex', padding: '4px 10px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '20px' }}>ជំពាក់</span>
                                        ) : (
                                            <span style={{ color: 'var(--color-primary)', fontWeight: 600, display: 'inline-flex', padding: '4px 10px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '20px' }}>សង</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '12px 20px', fontSize: '13px', fontWeight: 600, color: 'var(--color-primary)' }}>
                                        {supplier.name.substring(0, 15)}
                                    </td>
                                    <td style={{ padding: '12px 20px', fontSize: '13px', color: 'var(--color-text-main)' }}>
                                        {entry.description}
                                    </td>
                                    <td style={{ padding: '12px 20px', fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                        {entry.type === 'Invoice' ? `SA${entry.reference}` : entry.reference}
                                    </td>
                                    <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: entry.debt > 0 ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                                        {entry.debt > 0 ? formatCurrency(entry.debt) : ''}
                                    </td>
                                    <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: entry.paid > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
                                        {entry.paid > 0 ? formatCurrency(entry.paid) : ''}
                                    </td>
                                    <td style={{ padding: '12px 20px', textAlign: 'right', fontSize: '14px', fontWeight: 600, color: entry.balance > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                                        {formatCurrency(entry.balance)}
                                    </td>
                                    <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                                        <button 
                                            onClick={() => handleDeleteLedgerEntry(entry)}
                                            style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', opacity: 0.7 }}
                                            title="Delete Entry"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default SupplierDetailsPage;
