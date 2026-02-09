import React from 'react';
import POSInterface from '../components/POSInterface';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';

const POS: React.FC = () => {
    const { editingOrder, setEditingOrder } = useStore();
    const { setHeaderContent } = useHeader();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Point of Sale</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Process new sales</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    // Clear editing order when unmounting, or maybe we want to keep it?
    // Usually, if we navigate away, we might want to clear it.
    // But for now, let's just handle the props.

    return (
        <POSInterface
            orderToEdit={editingOrder}
            onCancelEdit={() => setEditingOrder(null)}
        />
    );
};

export default POS;
