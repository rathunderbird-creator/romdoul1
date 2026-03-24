
import { ShippingPointContent } from './ShippingPointContent';

interface ShippingPointSelectorProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (data: {
        province: string;
        provinceLatin?: string;
        district?: string;
        commune?: string;
        village?: string;
        addressDetail: string;
        customName: string;
        courier: string;
        phone: string;
        contactName: string;
    }) => void;
    shippingCompanies?: string[];
}

export default function ShippingPointSelector({ isOpen, onClose, onSelect }: ShippingPointSelectorProps) {
    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px'
        }}>
            <div style={{
                width: '100%',
                height: '100%',
                maxWidth: '1400px',
                background: 'var(--color-bg)',
                borderRadius: '24px',
                overflow: 'hidden',
                boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
                display: 'flex',
                flexDirection: 'column',
                animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
                <ShippingPointContent mode="selector" onSelect={(data) => {
                    onSelect(data);
                    onClose();
                }} onClose={onClose} />
            </div>
        </div>
    );
}
