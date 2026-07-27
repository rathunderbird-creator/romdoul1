import { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Calendar } from 'lucide-react';
import { useHeader } from '../../context/HeaderContext';
import { Modal } from '../../components';
import { useAccounting } from '../../hooks/useAccounting';
import type { JournalEntryLine } from '../../types';

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

const JournalEntriesPage = () => {
    const { setHeaderContent } = useHeader();
    const { journalEntries, accounts, isLoading, fetchJournalEntries, fetchAccounts, saveJournalEntry } = useAccounting();

    const [isModalOpen, setIsModalOpen] = useState(false);
    
    // Form state
    const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
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
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Journal Entries</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Record and view manual accounting entries</p>
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
        setDate(new Date().toISOString().split('T')[0]);
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
            // handled in hook
        }
    };

    const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts]);

    return (
        <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 'bold' }}>Journal Entries</h2>
                <button 
                    className="primary-button" 
                    onClick={handleOpenModal}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '8px' }}
                >
                    <Plus size={18} /> New Entry
                </button>
            </div>

            <div className="glass-panel" style={{ borderRadius: '12px', padding: '24px' }}>
                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>Loading...</div>
                ) : journalEntries.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-secondary)' }}>No journal entries found</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {journalEntries.map(entry => (
                            <div key={entry.id} style={{ border: '1px solid var(--color-border)', borderRadius: '8px', padding: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px dashed var(--color-border)' }}>
                                    <div>
                                        <div style={{ fontWeight: 600, fontSize: '15px' }}>{entry.description || 'No Description'}</div>
                                        <div style={{ display: 'flex', gap: '16px', color: 'var(--color-text-secondary)', fontSize: '13px', marginTop: '4px' }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={14}/> {new Date(entry.date).toLocaleDateString()}</span>
                                            {entry.reference_id && <span>Ref: {entry.reference_id}</span>}
                                        </div>
                                    </div>
                                    <div style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: '15px' }}>
                                        {formatCurrency(entry.lines?.reduce((sum, l) => sum + (l.debit || 0), 0) || 0)}
                                    </div>
                                </div>
                                <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
                                    <tbody>
                                        {entry.lines?.map((line, idx) => (
                                            <tr key={line.id || idx}>
                                                <td style={{ padding: '4px 0', color: 'var(--color-text)' }}>
                                                    {line.account?.account_code} - {line.account?.account_name}
                                                </td>
                                                <td style={{ padding: '4px 0', textAlign: 'right', color: line.debit ? 'var(--color-green)' : 'transparent', width: '120px' }}>
                                                    {line.debit ? formatCurrency(line.debit) : '-'}
                                                </td>
                                                <td style={{ padding: '4px 0', textAlign: 'right', color: line.credit ? 'var(--color-red)' : 'transparent', width: '120px' }}>
                                                    {line.credit ? formatCurrency(line.credit) : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Modal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                title="New Journal Entry"
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px 0' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Date</label>
                            <input 
                                type="date" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px' }}
                                value={date} 
                                onChange={(e) => setDate(e.target.value)} 
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Reference (Optional)</label>
                            <input 
                                type="text" 
                                className="input-field" 
                                style={{ width: '100%', padding: '10px' }}
                                value={referenceId} 
                                onChange={(e) => setReferenceId(e.target.value)} 
                                placeholder="e.g. INV-1002"
                            />
                        </div>
                    </div>
                    
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>Description</label>
                        <input 
                            type="text" 
                            className="input-field" 
                            style={{ width: '100%', padding: '10px' }}
                            value={description} 
                            onChange={(e) => setDescription(e.target.value)} 
                            placeholder="Reason for this entry"
                        />
                    </div>

                    <div style={{ marginTop: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <label style={{ fontWeight: 500 }}>Line Items</label>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                                    <th style={{ padding: '8px 4px', textAlign: 'left' }}>Account</th>
                                    <th style={{ padding: '8px 4px', textAlign: 'right', width: '100px' }}>Debit</th>
                                    <th style={{ padding: '8px 4px', textAlign: 'right', width: '100px' }}>Credit</th>
                                    <th style={{ padding: '8px 4px', width: '40px' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((line, index) => (
                                    <tr key={index}>
                                        <td style={{ padding: '4px' }}>
                                            <select 
                                                className="input-field" 
                                                style={{ width: '100%', padding: '8px', fontSize: '13px' }}
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
                                                className="input-field" 
                                                style={{ width: '100%', padding: '8px', textAlign: 'right', fontSize: '13px' }}
                                                value={line.debit || ''}
                                                min="0"
                                                onChange={(e) => updateLine(index, 'debit', parseFloat(e.target.value) || 0)}
                                            />
                                        </td>
                                        <td style={{ padding: '4px' }}>
                                            <input 
                                                type="number" 
                                                className="input-field" 
                                                style={{ width: '100%', padding: '8px', textAlign: 'right', fontSize: '13px' }}
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
                                                    color: lines.length > 2 ? 'var(--color-red)' : 'var(--color-text-muted)',
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
                            className="secondary-button" 
                            onClick={addLine}
                            style={{ marginTop: '8px', padding: '6px 12px', fontSize: '13px', borderRadius: '6px' }}
                        >
                            + Add Line
                        </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '32px', margin: '16px 0', padding: '16px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px' }}>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Total Debit</div>
                            <div style={{ fontWeight: 'bold', fontSize: '16px', color: 'var(--color-green)' }}>{formatCurrency(totalDebit)}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Total Credit</div>
                            <div style={{ fontWeight: 'bold', fontSize: '16px', color: 'var(--color-red)' }}>{formatCurrency(totalCredit)}</div>
                        </div>
                    </div>
                    {!isBalanced && totalDebit > 0 && totalCredit > 0 && (
                        <div style={{ color: 'var(--color-red)', fontSize: '13px', textAlign: 'right' }}>
                            Debits and Credits must be equal to save. (Difference: {formatCurrency(Math.abs(totalDebit - totalCredit))})
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '16px' }}>
                        <button className="secondary-button" onClick={() => setIsModalOpen(false)} style={{ padding: '10px 16px', borderRadius: '8px' }}>Cancel</button>
                        <button 
                            className="primary-button" 
                            onClick={handleSave} 
                            disabled={!isFormValid}
                            style={{ padding: '10px 16px', borderRadius: '8px' }}
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
