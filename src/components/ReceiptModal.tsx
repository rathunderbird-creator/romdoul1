import React from 'react';
import { X, Printer } from 'lucide-react';
import type { Sale } from '../types';
import { useStore } from '../context/StoreContext';

interface ReceiptModalProps {
    sale: Sale;
    onClose: () => void;
}

const ReceiptModal: React.FC<ReceiptModalProps> = ({ sale, onClose }) => {
    const { storeAddress, storeName, phone, logo } = useStore();
    const handlePrint = () => {
        window.print();
    };

    return (
        <div style={{
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
                <div className="no-print" style={{
                    padding: '16px',
                    borderBottom: '1px solid #e5e5e5',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: '#f9fafb'
                }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Transaction Receipt</h3>
                    <button onClick={onClose} style={{ color: '#6b7280' }}>
                        <X size={20} />
                    </button>
                </div>

                <div id="receipt-content" style={{ padding: '32px', overflowY: 'auto' }}>
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
                    <div style={{ marginTop: '16px', borderTop: '1px dashed #ccc', borderBottom: '1px dashed #ccc', padding: '8px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                            <span>Date:</span>
                            <span>{new Date(sale.date).toLocaleDateString()}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                            <span>Time:</span>
                            <span>{new Date(sale.date).toLocaleTimeString()}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                            <span>Order No:</span>
                            <span>#{sale.id.slice(-6)}</span>
                        </div>
                        {sale.customer && (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                    <span>Customer:</span>
                                    <span>{sale.customer.name}</span>
                                </div>
                                {sale.customer.phone && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                        <span>Phone:</span>
                                        <span>{sale.customer.phone}</span>
                                    </div>
                                )}
                                {sale.customer.address && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                        <span>Address:</span>
                                        <span style={{ maxWidth: '60%', textAlign: 'right' }}>{sale.customer.address}</span>
                                    </div>
                                )}
                                {sale.customer.city && (
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


                    <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse', marginBottom: '16px' }}>
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', marginTop: '4px' }}>
                            <span>TOTAL KH(៛)</span>
                            <span>{(sale.total * 4100).toLocaleString()} ៛</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#666', marginTop: '8px' }}>
                            <span>Payment Method</span>
                            <span>{sale.paymentMethod}</span>
                        </div>
                    </div>


                </div>

                <div className="no-print" style={{ padding: '16px', borderTop: '1px solid #e5e5e5', backgroundColor: '#f9fafb' }}>
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

            <style>{`
        @media print {
          @page {
            size: 80mm 140mm;
            margin: 0;
          }
          body {
            width: 80mm;
            margin: 0;
            padding: 0;
          }
          body * {
            visibility: hidden;
          }
          .receipt-container, .receipt-container * {
            visibility: visible;
          }
          .receipt-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 80mm;
            min-height: 140mm;
            margin: 0;
            padding: 0;
            box-shadow: none !important;
            max-width: none !important;
            border-radius: 0;
          }
          .no-print {
            display: none !important;
          }
          #receipt-content {
            padding: 10px !important;
            overflow: visible !important;
          }
          /* Adjust font sizes for small paper */
          h1 { font-size: 14px !important; }
          h3 { font-size: 12px !important; }
          .receipt-container div, .receipt-container span, .receipt-container p, .receipt-container td, .receipt-container th {
             font-size: 10px !important;
          }
        }
      `}</style>
        </div >
    );
};

export default ReceiptModal;
