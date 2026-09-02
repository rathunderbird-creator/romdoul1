import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Search } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal } from '../../components';
import DateRangePicker from '../../components/DateRangePicker';
import { useAccounting } from '../../hooks/useAccounting';
import type { JournalEntryLine } from '../../types';

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};



const JournalEntriesPage = () => {
    const { setHeaderContent } = useHeader();
    const { journalEntries, accounts, isLoading, fetchJournalEntries, fetchAccounts, saveJournalEntry } = useAccounting();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    
    // Form state
    const [date, setDate] = useState(() => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
    const [description, setDescription] = useState('');
    const [referenceId, setReferenceId] = useState('');
    const [lines, setLines] = useState<Partial<JournalEntryLine>[]>([
        { account_id: '', debit: 0, credit: 0 },
        { account_id: '', debit: 0, credit: 0 }
    ]);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: '#1a1f36' }}>Journal Entries</h1>
                    <p style={{ color: '#8792a2', fontSize: '13px' }}>Record and review general journal entries.</p>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    useEffect(() => {
        fetchJournalEntries();
        fetchAccounts();
    }, [fetchJournalEntries, fetchAccounts]);



    const handleOpenModal = () => {
        setDate(new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0]);
        setDescription('');
        setReferenceId('');
        setLines([
            { account_id: '', debit: 0, credit: 0 },
            { account_id: '', debit: 0, credit: 0 }
        ]);
        setIsModalOpen(true);
    };

    const addLine = () => {
        setLines([...lines, { account_id: '', debit: 0, credit: 0 }]);
    };

    const removeLine = (index: number) => {
        setLines(lines.filter((_, i) => i !== index));
    };

    const updateLine = (index: number, field: keyof JournalEntryLine, value: any) => {
        const newLines = [...lines];
        
        // If updating debit, ensure credit is 0, and vice versa
        if (field === 'debit' && value > 0) {
            newLines[index] = { ...newLines[index], debit: value, credit: 0 };
        } else if (field === 'credit' && value > 0) {
            newLines[index] = { ...newLines[index], credit: value, debit: 0 };
        } else {
            newLines[index] = { ...newLines[index], [field]: value };
        }
        
        setLines(newLines);
    };

    const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
    const isBalanced = totalDebit > 0 && totalDebit === totalCredit;
    const isFormValid = isBalanced && lines.every(l => l.account_id) && date;

    const handleSave = async () => {
        if (!isFormValid) return;
        try {
            await saveJournalEntry(
                { date, description, reference_id: referenceId },
                lines
            );
            setIsModalOpen(false);
        } catch (error) {
            console.error(error);
        }
    };

    const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts]);

    const filteredEntries = useMemo(() => {
        let result = journalEntries;

        if (dateRange.start) {
            result = result.filter(e => e.date >= dateRange.start);
        }
        if (dateRange.end) {
            result = result.filter(e => e.date <= dateRange.end);
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(entry => 
                (entry.description?.toLowerCase().includes(q)) ||
                (entry.reference_id?.toLowerCase().includes(q)) ||
                (entry.id.toLowerCase().includes(q))
            );
        }
        
        return result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }, [journalEntries, searchQuery, dateRange]);

    return (
        <div style={{ padding: '32px', maxWidth: '100%', margin: '0 auto', background: '#f7f9fc', minHeight: 'var(--vh-full)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ position: 'relative', width: '350px' }}>
                        <Search size={16} color="#8792a2" style={{ position: 'absolute', left: '12px', top: '10px' }} />
                        <input 
                            type="text" 
                            placeholder="Search by entry number or description..." 
                            style={{ 
                                width: '100%', padding: '8px 12px 8px 36px', 
                                borderRadius: '8px', border: '1px solid #e2e8f0',
                                fontSize: '14px', outline: 'none', background: 'white'
                            }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '2px' }}>
                        <DateRangePicker value={dateRange} onChange={setDateRange} />
                    </div>
                    
                    {(dateRange.start || dateRange.end || searchQuery) && (
                        <button 
                            onClick={() => { setDateRange({ start: '', end: '' }); setSearchQuery(''); }} 
                            style={{ 
                                padding: '8px 12px', borderRadius: '8px', fontSize: '13px', 
                                color: '#ef4444', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 500
                            }}
                        >
                            Clear Filters
                        </button>
                    )}
                </div>
                <button 
                    onClick={handleOpenModal}
                    style={{ 
                        display: 'flex', alignItems: 'center', gap: '8px', 
                        padding: '10px 16px', borderRadius: '8px',
                        background: '#5469d4', color: 'white', border: 'none',
                        fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                >
                    <Plus size={16} /> New Entry
                </button>
            </div>

            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>Entry #</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>Date</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>Description</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase', textAlign: 'right' }}>Debit Total</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase', textAlign: 'right' }}>Credit Total</th>
                            <th style={{ padding: '16px 24px', fontWeight: 600, color: '#64748b', fontSize: '12px', textTransform: 'uppercase', textAlign: 'center' }}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading entries...</td></tr>
                        ) : filteredEntries.length === 0 ? (
                            <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>No entries found</td></tr>
                        ) : (
                            filteredEntries.map(entry => {
                                const totalDebits = entry.lines?.reduce((sum, l) => sum + (l.debit || 0), 0) || 0;
                                const totalCredits = entry.lines?.reduce((sum, l) => sum + (l.credit || 0), 0) || 0;
                                const displayId = entry.reference_id || `JE-${entry.id.substring(0, 8).toUpperCase()}`;
                                
                                return (
                                    <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9', background: '#ffffff', transition: 'background 0.2s' }}>
                                        <td style={{ padding: '16px 24px', fontWeight: '500', color: '#5469d4', cursor: 'pointer' }}>
                                            {displayId}
                                        </td>
                                        <td style={{ padding: '16px 24px', color: '#475569' }}>
                                            {new Date(entry.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td style={{ padding: '16px 24px', color: '#334155', fontWeight: '500' }}>
                                            {entry.description || 'No Description'}
                                        </td>
                                        <td style={{ padding: '16px 24px', fontWeight: '600', textAlign: 'right', color: '#334155' }}>
                                            {formatCurrency(totalDebits)}
                                        </td>
                                        <td style={{ padding: '16px 24px', fontWeight: '600', textAlign: 'right', color: '#334155' }}>
                                            {formatCurrency(totalCredits)}
                                        </td>
                                        <td style={{ padding: '16px 24px', textAlign: 'center' }}>
                                            <span style={{ 
                                                padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold',
                                                background: '#dcfce7', color: '#166534', letterSpacing: '0.5px'
                                            }}>
                                                POSTED
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            <Modal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                title="New Journal Entry"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 0' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px', color: '#334155' }}>Date</label>
                            <input 
                                type="date" 
                                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
                                value={date} 
                                onChange={(e) => setDate(e.target.value)} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px', color: '#334155' }}>Reference (Optional)</label>
                            <input 
                                type="text" 
                                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
                                value={referenceId} 
                                onChange={(e) => setReferenceId(e.target.value)} 
                                placeholder="e.g. INV-1002"
                            />
                        </div>
                    </div>
                    
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '14px', color: '#334155' }}>Description</label>
                        <input 
                            type="text" 
                            style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', outline: 'none' }}
                            value={description} 
                            onChange={(e) => setDescription(e.target.value)} 
                            placeholder="Reason for this entry"
                        />
                    </div>

                    <div style={{ marginTop: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <label style={{ fontWeight: 500, fontSize: '14px', color: '#334155' }}>Line Items</label>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #cbd5e1', color: '#64748b', fontSize: '12px', textTransform: 'uppercase' }}>
                                    <th style={{ padding: '8px 4px', textAlign: 'left', fontWeight: 600 }}>Account</th>
                                    <th style={{ padding: '8px 4px', textAlign: 'right', width: '100px', fontWeight: 600 }}>Debit</th>
                                    <th style={{ padding: '8px 4px', textAlign: 'right', width: '100px', fontWeight: 600 }}>Credit</th>
                                    <th style={{ padding: '8px 4px', width: '40px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((line, index) => (
                                    <tr key={index}>
                                        <td style={{ padding: '4px' }}>
                                            <select 
                                                style={{ width: '100%', padding: '8px', fontSize: '13px', borderRadius: '4px', border: '1px solid #cbd5e1', background: 'white', outline: 'none' }}
                                                value={line.account_id}
                                                onChange={(e) => updateLine(index, 'account_id', e.target.value)}
                                            >
                                                <option value="">Select Account</option>
                                                {activeAccounts.map(acc => (
                                                    <option key={acc.id} value={acc.id}>{acc.account_code} - {acc.account_name}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td style={{ padding: '4px' }}>
                                            <input 
                                                type="number" 
                                                style={{ width: '100%', padding: '8px', textAlign: 'right', fontSize: '13px', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none' }}
                                                value={line.debit || ''}
                                                min="0"
                                                onChange={(e) => updateLine(index, 'debit', parseFloat(e.target.value) || 0)}
                                            />
                                        </td>
                                        <td style={{ padding: '4px' }}>
                                            <input 
                                                type="number" 
                                                style={{ width: '100%', padding: '8px', textAlign: 'right', fontSize: '13px', borderRadius: '4px', border: '1px solid #cbd5e1', outline: 'none' }}
                                                value={line.credit || ''}
                                                min="0"
                                                onChange={(e) => updateLine(index, 'credit', parseFloat(e.target.value) || 0)}
                                            />
                                        </td>
                                        <td style={{ padding: '4px', textAlign: 'center' }}>
                                            <button 
                                                onClick={() => removeLine(index)} 
                                                disabled={lines.length <= 2}
                                                style={{ 
                                                    background: 'none', border: 'none', cursor: lines.length > 2 ? 'pointer' : 'not-allowed', 
                                                    color: lines.length > 2 ? '#ef4444' : '#cbd5e1',
                                                    padding: '4px'
                                                }}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <button 
                            onClick={addLine}
                            style={{ marginTop: '8px', padding: '6px 12px', fontSize: '13px', borderRadius: '6px', background: 'white', border: '1px solid #cbd5e1', color: '#475569', fontWeight: 500, cursor: 'pointer' }}
                        >
                            + Add Line
                        </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '32px', margin: '16px 0', padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Total Debit</div>
                            <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#10b981' }}>{formatCurrency(totalDebit)}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>Total Credit</div>
                            <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#ef4444' }}>{formatCurrency(totalCredit)}</div>
                        </div>
                    </div>
                    {!isBalanced && totalDebit > 0 && totalCredit > 0 && (
                        <div style={{ color: '#ef4444', fontSize: '13px', textAlign: 'right', fontWeight: 500 }}>
                            Debits and Credits must be equal to save. (Difference: {formatCurrency(Math.abs(totalDebit - totalCredit))})
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                        <button onClick={() => setIsModalOpen(false)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                        <button 
                            onClick={handleSave} 
                            disabled={!isFormValid}
                            style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#5469d4', color: 'white', fontWeight: 500, cursor: 'pointer', opacity: (!isFormValid) ? 0.5 : 1 }}
                        >
                            Save Entry
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default JournalEntriesPage;
