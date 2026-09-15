import React from 'react';

// Shimmer rows while a month loads (same look as the sibling page's loader).
const SkeletonRows: React.FC<{ rows: number; cols: number }> = ({ rows, cols }) => (
    <>
        {Array.from({ length: rows }, (_, r) => (
            <tr key={r} aria-hidden>
                {Array.from({ length: cols }, (_, c) => (
                    <td key={c} style={{ padding: '10px 12px' }}>
                        <div className="pip-skeleton" style={{ width: c === 0 ? 80 : 60, marginLeft: c > 0 ? 'auto' : undefined }} />
                    </td>
                ))}
            </tr>
        ))}
    </>
);

export default SkeletonRows;
