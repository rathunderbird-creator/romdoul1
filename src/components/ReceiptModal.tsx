import React from 'react';
import { X, Printer } from 'lucide-react';
import type { Sale } from '../types';
import { useStore } from '../context/StoreContext';

interface ReceiptModalProps {
    sale: Sale;
    onClose: () => void;
}

interface ReceiptContentProps {
    sale: Sale;
    variant: 'full' | 'simple';
}

const ReceiptContent: React.FC<ReceiptContentProps> = ({ sale, variant }) => {
    const { storeAddress, storeName, phone, logo } = useStore();

    return (
        <div style={{ padding: variant === 'simple' ? '20px 32px' : '32px', overflowY: 'visible' }}>
            {variant === 'full' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', textAlign: 'left' }}>
                    {logo && (
                        <img
                            src={logo}
                            alt="Store Logo"
                            style={{
                                width: '60px',
                                height: '60px',
                                objectFit: 'contain',
                                flexShrink: 0
                            }}
                        />
                    )}
                    <div>
                        <h1 style={{ fontSize: '16px', fontWeight: 'bold', margin: '0 0 4px 0', color: '#000000', background: 'none', WebkitTextFillColor: 'black', lineHeight: '1.2' }}>{storeName || 'JBL STORE'}</h1>
                        {storeAddress && <div style={{ fontSize: '12px', color: '#000', fontWeight: 'bold', lineHeight: '1.2' }}>{storeAddress}</div>}
                        {phone && <div style={{ fontSize: '12px', color: '#000', fontWeight: 'bold', lineHeight: '1.2' }}>{phone}</div>}
                    </div>
                </div>
            ) : (
                <div style={{ textAlign: 'center', marginBottom: '16px', fontWeight: 'bold', fontSize: '14px', borderBottom: '2px solid black', paddingBottom: '8px' }}>
                    STOCK COPY
                </div>
            )}

            <div style={{ marginTop: '16px', borderTop: '1px dashed #ccc', borderBottom: '1px dashed #ccc', padding: '8px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span>Date:</span>
                    <span>{new Date(sale.date).toLocaleDateString()}</span>
                </div>
                {variant === 'full' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span>Time:</span>
                        <span>{new Date(sale.date).toLocaleTimeString()}</span>
                    </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span>Order No:</span>
                    <span>#{sale.id.slice(-6)}</span>
                </div>
                {sale.customer && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                            <span>Customer:</span>
                            <span style={{ fontWeight: 'bold' }}>{sale.customer.name}</span>
                        </div>
                        {sale.customer.phone && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                <span>Phone:</span>
                                <span style={{ fontWeight: 'bold' }}>{sale.customer.phone}</span>
                            </div>
                        )}
                        {variant === 'full' && sale.customer.address && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                <span>Address:</span>
                                <span style={{ maxWidth: '60%', textAlign: 'right' }}>{sale.customer.address}</span>
                            </div>
                        )}
                        {variant === 'full' && sale.customer.city && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                <span>City:</span>
                                <span>{sale.customer.city}</span>
                            </div>
                        )}
                    </>
                )}
                {sale.salesman && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span>Salesman:</span>
                        <span>{sale.salesman}</span>
                    </div>
                )}
            </div>

            <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', marginBottom: '16px', marginTop: '16px' }}>
                <thead>
                    <tr style={{ borderBottom: '1px solid #eee' }}>
                        <th style={{ textAlign: 'left', padding: '8px 0' }}>Item</th>
                        <th style={{ textAlign: 'center', padding: '8px 0' }}>Qty</th>
                        <th style={{ textAlign: 'right', padding: '8px 0' }}>Price</th>
                    </tr>
                </thead>
                <tbody>
                    {sale.items.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px dashed #eee' }}>
                            <td style={{ padding: '8px 0' }}>{item.name}</td>
                            <td style={{ textAlign: 'center', padding: '8px 0' }}>{item.quantity}</td>
                            <td style={{ textAlign: 'right', padding: '8px 0' }}>${(item.price * item.quantity).toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div style={{ borderTop: '2px solid #000', paddingTop: '12px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '16px' }}>
                    <span>TOTAL</span>
                    <span>${sale.total.toFixed(2)}</span>
                </div>
                {variant === 'full' && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', marginTop: '4px' }}>
                            <span>TOTAL KH(៛)</span>
                            <span>{(sale.total * 4100).toLocaleString()} ៛</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666', marginTop: '8px' }}>
                            <span>Payment Method</span>
                            <span>{sale.paymentMethod}</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

const ReceiptModal: React.FC<ReceiptModalProps> = ({ sale, onClose }) => {
    const [printTwoCopies, setPrintTwoCopies] = React.useState(true);

    const handlePrint = () => {
        window.print();
    };

    return (
        <>
            {/* Modal for Screen Viewing */}
            <div className="receipt-overlay no-print" style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                backdropFilter: 'blur(4px)'
            }}>
                <div className="receipt-container" style={{
                    backgroundColor: 'white',
                    color: 'black',
                    width: '100%',
                    maxWidth: '380px',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                    display: 'flex',
                    flexDirection: 'column',
                    maxHeight: '90vh'
                }}>
                    <div style={{
                        padding: '16px',
                        borderBottom: '1px solid #e5e5e5',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        backgroundColor: '#f9fafb'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Transaction Receipt</h3>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', userSelect: 'none', background: 'white', padding: '4px 8px', borderRadius: '6px', border: '1px solid #e5e5e5' }}>
                                <input
                                    type="checkbox"
                                    checked={printTwoCopies}
                                    onChange={(e) => setPrintTwoCopies(e.target.checked)}
                                    style={{
                                        accentColor: 'var(--color-primary)',
                                        width: '16px',
                                        height: '16px'
                                    }}
                                />
                                Print 2 Copies
                            </label>
                        </div>
                        <button onClick={onClose} style={{ color: '#6b7280' }}>
                            <X size={20} />
                        </button>
                    </div>

                    <div style={{ padding: '0', overflowY: 'auto' }}>
                        <ReceiptContent sale={sale} variant="full" />

                        {printTwoCopies && (
                            <div style={{ borderTop: '2px dashed #eee', margin: '20px', textAlign: 'center', color: '#888', fontSize: '12px', padding: '10px' }}>
                                [Stock Copy will print on next page]
                            </div>
                        )}
                    </div>

                    <div style={{ padding: '16px', borderTop: '1px solid #e5e5e5', backgroundColor: '#f9fafb' }}>
                        <button
                            onClick={handlePrint}
                            style={{
                                width: '100%',
                                padding: '12px',
                                backgroundColor: 'var(--color-primary)',
                                color: 'white',
                                borderRadius: '8px',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px'
                            }}
                        >
                            <Printer size={18} />
                            Print Receipt
                        </button>
                    </div>
                </div>
            </div>

            {/* Hidden Print-Only Container */}
            <div id="printable-area" style={{ display: 'none' }}>
                <ReceiptContent sale={sale} variant="full" />
                {printTwoCopies && (
                    <>
                        <div className="page-break" style={{ pageBreakBefore: 'always', breakBefore: 'page', height: '1px', width: '100%', visibility: 'hidden' }}></div>
                        <ReceiptContent sale={sale} variant="simple" />
                    </>
                )}
            </div>

            <style>{`
        @media print {
            @page {
                size: 80mm 140mm;
                margin: 0;
            }
            body * {
                visibility: hidden;
            }
            .no-print {
                display: none !important;
            }
            
            #printable-area, #printable-area * {
                visibility: visible;
            }
            #printable-area {
                display: block !important;
                position: absolute;
                left: 0;
                top: 0;
                width: 100%;
            }
            
            /* Ensure page breaks work */
            .page-break {
                page-break-before: always !important;
                break-before: page !important;
                display: block !important;
                height: 1px;
            }

            /* Adjust font sizes for small paper */
            h1 { font-size: 14px !important; }
            h3 { font-size: 12px !important; }
            #printable-area div, #printable-area span, #printable-area p, #printable-area td, #printable-area th {
                font-size: 10px !important;
            }
        }
      `}</style>
        </>
    );
};

export default ReceiptModal;
