import React from 'react';
import { MapPin, Navigation as NavIcon } from 'lucide-react';
import { useHeader } from '../context/HeaderContext';

const ShippingLocation: React.FC = () => {
    const { setHeaderContent } = useHeader();

    React.useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <MapPin size={20} />
                    <span className="font-semibold text-color-text-main" style={{ fontSize: '18px' }}>ទីតាំងដឹកជញ្ជូន</span>
                </div>
            )
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Header Description */}
            <div style={{ padding: '24px 24px 16px', flexShrink: 0 }}>
                <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>ភូមិសាស្ត្រកម្ពុជា</h1>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', margin: 0 }}>
                    មូលដ្ឋានទិន្នន័យផ្លូវការនៃរាជធានី ខេត្ត ក្រុង ស្រុក ខណ្ឌ ឃុំ សង្កាត់ ក្នុងប្រទេសកម្ពុជា
                </p>
            </div>

            {/* Iframe Container */}
            <div style={{ flex: 1, padding: '0 24px 24px' }}>
                <div style={{
                    width: '100%',
                    height: '100%',
                    minHeight: '600px',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
                    background: 'var(--color-surface)',
                    position: 'relative'
                }}>
                    <iframe
                        src="https://cambo-gazetteer.manethpak.dev/"
                        title="Cambodia Gazetteer"
                        style={{ width: '100%', height: '100%', border: 'none' }}
                        allowFullScreen
                    />
                </div>
            </div>

            {/* Footer Source */}
            <div style={{ paddingBottom: '24px', textAlign: 'center', fontSize: '13px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', flexShrink: 0 }}>
                <NavIcon size={14} />
                <span>អាស័យដ្ឋាន និងទិន្នន័យយោងដកស្រង់ចេញពីគេហទំព័រ NCDD និង Cambo Gazetteer។</span>
            </div>
        </div>
    );
};

export default ShippingLocation;
