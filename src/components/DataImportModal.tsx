import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Upload, FileSpreadsheet, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';

interface DataImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'product' | 'order';
    onImport: (data: any[]) => Promise<void>;
}

const DataImportModal: React.FC<DataImportModalProps> = ({ isOpen, onClose, type, onImport }) => {
    const { showToast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [previewData, setPreviewData] = useState<any[]>([]);
    const [headers, setHeaders] = useState<string[]>([]);
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
    const [isProcessing, setIsProcessing] = useState(false);

    if (!isOpen) return null;

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            parseFile(selectedFile);
        }
    };

    const parseFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

                if (jsonData.length > 0) {
                    setHeaders(jsonData[0] as string[]);
                    const rows = (jsonData.slice(1) as any[]).filter(row => row.length > 0);
                    setPreviewData(rows);
                    // Default select all
                    setSelectedIndices(new Set(rows.map((_, i) => i)));
                }
            } catch (error) {
                console.error("Error parsing file:", error);
                showToast('Failed to parse Excel file', 'error');
            }
        };
        reader.readAsBinaryString(file);
    };

    const handleDownloadTemplate = () => {
        let templateData: any[] = [];

        if (type === 'product') {
            templateData = [
                { Name: 'Example Product', Model: 'MDL-001', Price: 100, Stock: 50, Category: 'Portable' }
            ];
        } else {
            templateData = [
                {
                    'Date': '2023-10-27',
                    'Customer': 'John Doe',
                    'Phone': '012345678',
                    'Address': '#123, St 456, Phnom Penh',
                    'Page': 'JBL Cambodia',
                    'Salesman': 'Sopheak',
                    'Customer Care': 'Dara',
                    'Items': 'Item A x1, Item B x2',
                    'Total Amount': 150,
                    'Payment Method': 'Cash',
                    'Payment Status': 'Paid',
                    'Settle Date': '2023-10-28',
                    'Shipping Company': 'J&T',
                    'Shipping Status': 'Delivered',
                    'Tracking Number': 'TRACK-123',
                    'Remarks': 'Test order'
                }
            ];
        }

        const ws = XLSX.utils.json_to_sheet(templateData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Template");
        XLSX.writeFile(wb, `${type}_import_template.xlsx`);
    };

    const handleClose = () => {
        setFile(null);
        setPreviewData([]);
        setHeaders([]);
        setSelectedIndices(new Set());
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
        onClose();
    };

    const handleImport = async () => {
        if (selectedIndices.size === 0) {
            showToast('Please select at least one item to import', 'error');
            return;
        }

        setIsProcessing(true);
        try {
            // Filter data based on selection
            const selectedRows = previewData.filter((_, i) => selectedIndices.has(i));

            // Convert preview array back to object based on headers
            const formattedData = selectedRows.map(row => {
                const obj: any = {};
                headers.forEach((header, index) => {
                    obj[header] = row[index];
                });
                return obj;
            });

            await onImport(formattedData);
            showToast(`Successfully imported ${formattedData.length} items`, 'success');
            handleClose();
        } catch (error) {
            console.error("Import error:", error);
            showToast('Failed to import data', 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
            <div className="glass-panel" style={{ width: '90vw', maxWidth: '1200px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: '0', overflow: 'hidden' }}>

                {/* Header */}
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Import {type === 'product' ? 'Products' : 'Orders'}</h3>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>Upload an Excel file to bulk import data</p>
                    </div>
                    <button onClick={handleClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>

                    {/* Action Buttons */}
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                flex: 1, height: '120px', border: '2px dashed var(--color-border)', borderRadius: '12px',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                gap: '12px', cursor: 'pointer', background: 'var(--color-surface)', transition: 'all 0.2s'
                            }}
                            className="hover-border-primary"
                        >
                            <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--color-primary-light)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Upload size={20} />
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontWeight: 500, marginBottom: '4px' }}>Click to upload Excel file</div>
                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{file ? file.name : 'XLSX or CSV files'}</div>
                            </div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                style={{ display: 'none' }}
                                accept=".xlsx, .xls, .csv"
                                onChange={handleFileChange}
                            />
                        </button>

                        <button
                            onClick={handleDownloadTemplate}
                            style={{
                                width: '200px', border: '1px solid var(--color-border)', borderRadius: '12px',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                gap: '12px', cursor: 'pointer', background: 'var(--color-surface)'
                            }}
                        >
                            <FileSpreadsheet size={24} style={{ color: '#10B981' }} />
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontWeight: 500 }}>Download Template</div>
                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Get the correct format</div>
                            </div>
                        </button>
                    </div>

                    {/* Preview Area */}
                    {previewData.length > 0 && (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <h4 style={{ fontSize: '14px', fontWeight: 600 }}>Preview ({previewData.length} items)</h4>
                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Showing first 5 rows</div>
                            </div>
                            <div style={{ overflow: 'auto', maxHeight: '600px', border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                                <table className="spreadsheet-table" style={{ border: 'none', borderCollapse: 'separate', borderSpacing: 0 }}>
                                    <thead style={{ background: '#F9FAFB' }}>
                                        <tr>
                                            <th style={{ padding: '10px 16px', width: '40px', position: 'sticky', top: 0, zIndex: 10, background: '#F9FAFB', borderBottom: '1px solid var(--color-border)' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={previewData.length > 0 && selectedIndices.size === previewData.length}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedIndices(new Set(previewData.map((_, i) => i)));
                                                        } else {
                                                            setSelectedIndices(new Set());
                                                        }
                                                    }}
                                                    style={{ cursor: 'pointer' }}
                                                />
                                            </th>
                                            {headers.map((header, i) => (
                                                <th key={i} style={{ padding: '10px 16px', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', textAlign: 'left', position: 'sticky', top: 0, zIndex: 10, background: '#F9FAFB', borderBottom: '1px solid var(--color-border)' }}>{header}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {previewData.slice(0, 50).map((row, i) => (
                                            <tr key={i} style={{ borderBottom: '1px solid var(--color-border)', background: selectedIndices.has(i) ? 'rgba(37, 99, 235, 0.05)' : 'transparent' }}>
                                                <td style={{ padding: '10px 16px' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIndices.has(i)}
                                                        onChange={() => {
                                                            const newSet = new Set(selectedIndices);
                                                            if (newSet.has(i)) {
                                                                newSet.delete(i);
                                                            } else {
                                                                newSet.add(i);
                                                            }
                                                            setSelectedIndices(newSet);
                                                        }}
                                                        style={{ cursor: 'pointer' }}
                                                    />
                                                </td>
                                                {row.map((cell: any, j: number) => (
                                                    <td key={j} style={{ padding: '10px 16px', fontSize: '13px' }}>{cell}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#F9FAFB' }}>
                    <button
                        onClick={handleClose}
                        style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer' }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleImport}
                        disabled={previewData.length === 0 || isProcessing}
                        className="primary-button"
                        style={{ padding: '10px 24px', opacity: (previewData.length === 0 || isProcessing) ? 0.5 : 1 }}
                    >
                        {isProcessing ? 'Importing...' : `Confirm Import (${selectedIndices.size})`}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DataImportModal;
