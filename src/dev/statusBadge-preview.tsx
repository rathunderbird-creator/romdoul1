// Dev-only preview: open http://localhost:5173/dev/statusBadge.html while `npm run dev` is running.
//
// The order and payment status dropdowns in a long table inside a scrolling
// container, under the same zoomed <body> the app uses (index.css), so their
// popup placement can be checked without logging in. Add ?zoom=1.1 to try a
// larger Text Size.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import StatusBadge from '../components/StatusBadge';
import PaymentStatusBadge from '../components/PaymentStatusBadge';

const zoom = new URLSearchParams(location.search).get('zoom');
if (zoom) document.body.style.setProperty('zoom', zoom);

const STATUSES = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Returned', 'ReStock', 'Drafted'];

function Row({ i }: { i: number }) {
    const [status, setStatus] = useState(STATUSES[i % STATUSES.length]);
    const [pay, setPay] = useState('Unpaid');
    return (
        <tr style={{ borderTop: '1px solid var(--color-border)' }}>
            <td style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>Order {1000 + i}</td>
            <td style={{ padding: '6px 12px', width: '150px' }} data-testid={`status-${i}`}>
                <StatusBadge status={status} bold={false} unrestricted onChange={setStatus} />
            </td>
            <td style={{ padding: '6px 12px', width: '130px' }} data-testid={`pay-${i}`}>
                <PaymentStatusBadge status={pay} bold={false} onChange={setPay} />
            </td>
            {Array.from({ length: 8 }, (_, k) => <td key={k} style={{ padding: '6px 12px', whiteSpace: 'nowrap' }}>column {k + 1} filler text</td>)}
        </tr>
    );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <div style={{ height: 'var(--vh-full)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px', fontWeight: 700 }}>Status dropdown preview (body zoom {getComputedStyle(document.body).zoom})</div>
            <main style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
                <div style={{ overflow: 'auto', maxHeight: 'calc(var(--vh-full) - 80px)' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: '13px' }}>
                        <tbody>{Array.from({ length: 40 }, (_, i) => <Row key={i} i={i} />)}</tbody>
                    </table>
                </div>
            </main>
        </div>
    </StrictMode>
);
