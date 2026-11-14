import React from 'react';
import POSInterface from '../components/POSInterface';
import { useStore } from '../context/StoreContext';
import { useHeader } from '../context/HeaderContext';
import { useLanguage } from '../context/LanguageContext';

const POS: React.FC = () => {
    const { editingOrder, setEditingOrder } = useStore();
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>{t('ui.people.pos.title')}</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>{t('ui.people.pos.subtitle')}</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent, t]);

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
