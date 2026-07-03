import React, { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import DateRangePicker from './DateRangePicker';
import { supabase } from '../lib/supabase';
import { FileText, CheckCircle, Clock, XCircle, Loader2, Printer } from 'lucide-react';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ReportData {
  totalOrders: number;
  totalAmount: number;
  totalReceived: number;
  totalRemaining: number;
  byStatus: { status: string; count: number; amount: number }[];
  byShippingCo: { company: string; count: number; amount: number }[];
  bySalesman: { salesman: string; count: number; amount: number }[];
}

const getTodayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ReportModal: React.FC<ReportModalProps> = ({ isOpen, onClose }) => {
  const today = getTodayStr();
  const [dateRange, setDateRange] = useState({ start: today, end: today });
  const [report, setReport] = useState<ReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReport = useCallback(async (range: { start: string; end: string }) => {
    setIsLoading(true);
    try {
      let query = supabase.from('sales').select('total, amount_received, payment_status, shipping_company, salesman');

      if (range.start) {
        const start = new Date(range.start);
        start.setHours(0, 0, 0, 0);
        query = query.gte('date', start.toISOString());
      }
      if (range.end) {
        const end = new Date(range.end);
        end.setHours(23, 59, 59, 999);
        query = query.lte('date', end.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows = data || [];
      const totalOrders = rows.length;
      const totalAmount = rows.reduce((s, r) => s + (r.total || 0), 0);
      const totalReceived = rows.reduce((s, r) => s + (r.amount_received || 0), 0);
      const totalRemaining = totalAmount - totalReceived;

      // By status
      const statusMap = new Map<string, { count: number; amount: number }>();
      for (const r of rows) {
        const st = r.payment_status || 'Unpaid';
        const cur = statusMap.get(st) || { count: 0, amount: 0 };
        cur.count++;
        cur.amount += r.total || 0;
        statusMap.set(st, cur);
      }
      const byStatus = Array.from(statusMap.entries()).map(([status, v]) => ({ status, ...v }));

      // By shipping company
      const shipMap = new Map<string, { count: number; amount: number }>();
      for (const r of rows) {
        const co = r.shipping_company || 'N/A';
        const cur = shipMap.get(co) || { count: 0, amount: 0 };
        cur.count++;
        cur.amount += r.total || 0;
        shipMap.set(co, cur);
      }
      const byShippingCo = Array.from(shipMap.entries())
        .map(([company, v]) => ({ company, ...v }))
        .sort((a, b) => b.amount - a.amount);

      // By salesman
      const salesMap = new Map<string, { count: number; amount: number }>();
      for (const r of rows) {
        const sm = r.salesman || 'N/A';
        const cur = salesMap.get(sm) || { count: 0, amount: 0 };
        cur.count++;
        cur.amount += r.total || 0;
        salesMap.set(sm, cur);
      }
      const bySalesman = Array.from(salesMap.entries())
        .map(([salesman, v]) => ({ salesman, ...v }))
        .sort((a, b) => b.amount - a.amount);

      setReport({ totalOrders, totalAmount, totalReceived, totalRemaining, byStatus, byShippingCo, bySalesman });
    } catch (err) {
      console.error('Failed to fetch report:', err);
      setReport(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Auto-fetch on open and when date changes
  useEffect(() => {
    if (isOpen) {
      fetchReport(dateRange);
    }
  }, [isOpen, dateRange, fetchReport]);

  // Reset to today when opening
  useEffect(() => {
    if (isOpen) {
      const t = getTodayStr();
      setDateRange({ start: t, end: t });
    }
  }, [isOpen]);

  const handlePrint = () => {
    const printContent = document.getElementById('report-print-area');
    if (!printContent) return;
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Payment Tracking Report</title>
          <style>
            body { font-family: 'Segoe UI', sans-serif; padding: 24px; color: #1a1a1a; }
            h2 { margin-bottom: 4px; }
            .subtitle { color: #666; font-size: 13px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { padding: 8px 12px; border: 1px solid #ddd; text-align: left; font-size: 13px; }
            th { background: #f5f5f5; font-weight: 600; }
            .summary-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 24px; }
            .summary-card { padding: 12px; border: 1px solid #ddd; border-radius: 8px; }
            .summary-card .label { font-size: 11px; color: #666; }
            .summary-card .value { font-size: 18px; font-weight: 700; margin-top: 4px; }
          </style>
        </head>
        <body>${printContent.innerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const formatCurrency = (n: number) => `$${n.toFixed(2)}`;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Paid': return '#10B981';
      case 'Unpaid': return '#F59E0B';
      case 'Get File': return '#3B82F6';
      case 'Cancel': return '#EF4444';
      default: return '#6B7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Paid': return <CheckCircle size={14} />;
      case 'Unpaid': return <Clock size={14} />;
      case 'Cancel': return <XCircle size={14} />;
      default: return <FileText size={14} />;
    }
  };

  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Payment Tracking Report" width="720px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Date selector + Print */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <DateRangePicker
              value={dateRange}
              onChange={(range) => setDateRange(range)}
              compact
            />
          </div>
          <button
            onClick={handlePrint}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--color-surface)',
              color: 'var(--color-text-main)',
              border: '1px solid var(--color-border)',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
            }}
          >
            <Printer size={15} />
            Print
          </button>
        </div>

        {/* Report Content */}
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '60px 0', color: 'var(--color-text-muted)' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ marginLeft: '10px', fontSize: '14px' }}>Generating report...</span>
          </div>
        ) : report ? (
          <div id="report-print-area" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Report Header */}
            <div style={{ textAlign: 'center', paddingBottom: '12px', borderBottom: '1px solid var(--color-border)' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--color-text-main)' }}>Payment Tracking Report</h2>
              <div className="subtitle" style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                {dateRange.start === dateRange.end
                  ? formatDateDisplay(dateRange.start)
                  : `${formatDateDisplay(dateRange.start)} — ${formatDateDisplay(dateRange.end)}`}
              </div>
            </div>

            {/* Summary Cards */}
            <div className="summary-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
              <div style={{ padding: '14px', borderRadius: '10px', background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(139,92,246,0.1))', border: '1px solid rgba(99,102,241,0.2)' }}>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 500 }}>Total Orders</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#6366F1', marginTop: '4px' }}>{report.totalOrders}</div>
              </div>
              <div style={{ padding: '14px', borderRadius: '10px', background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(5,150,105,0.1))', border: '1px solid rgba(16,185,129,0.2)' }}>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 500 }}>Total Amount</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#10B981', marginTop: '4px' }}>{formatCurrency(report.totalAmount)}</div>
              </div>
              <div style={{ padding: '14px', borderRadius: '10px', background: 'linear-gradient(135deg, rgba(59,130,246,0.1), rgba(37,99,235,0.1))', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 500 }}>Total Received</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#3B82F6', marginTop: '4px' }}>{formatCurrency(report.totalReceived)}</div>
              </div>
              <div style={{ padding: '14px', borderRadius: '10px', background: 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(217,119,6,0.1))', border: '1px solid rgba(245,158,11,0.2)' }}>
                <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontWeight: 500 }}>Remaining</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#F59E0B', marginTop: '4px' }}>{formatCurrency(report.totalRemaining)}</div>
              </div>
            </div>

            {/* By Payment Status */}
            <div>
              <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>By Payment Status</h3>
              <div style={{ borderRadius: '8px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--color-bg)' }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Status</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Orders</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byStatus.map((row) => (
                      <tr key={row.status} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '8px 12px', fontSize: '13px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: getStatusColor(row.status) }}>
                            {getStatusIcon(row.status)}
                            {row.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>{row.count}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>{formatCurrency(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* By Shipping Company */}
            {report.byShippingCo.length > 0 && (
              <div>
                <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>By Shipping Company</h3>
                <div style={{ borderRadius: '8px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg)' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Company</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Orders</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byShippingCo.map((row) => (
                        <tr key={row.company} style={{ borderTop: '1px solid var(--color-border)' }}>
                          <td style={{ padding: '8px 12px', fontSize: '13px' }}>{row.company}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>{row.count}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>{formatCurrency(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* By Salesman */}
            {report.bySalesman.length > 0 && (
              <div>
                <h3 style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--color-text-main)' }}>By Salesman</h3>
                <div style={{ borderRadius: '8px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--color-bg)' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Salesman</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Orders</th>
                        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.bySalesman.map((row) => (
                        <tr key={row.salesman} style={{ borderTop: '1px solid var(--color-border)' }}>
                          <td style={{ padding: '8px 12px', fontSize: '13px' }}>{row.salesman}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>{row.count}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '13px', fontWeight: 600 }}>{formatCurrency(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)', fontSize: '14px' }}>
            No data available
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </Modal>
  );
};

export default ReportModal;
