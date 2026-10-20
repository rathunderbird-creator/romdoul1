/**
 * Shared matching logic for backfill-transaction-order-links.cjs and
 * spotcheck-transaction-order-links.cjs — kept in one place so the spot-check
 * is guaranteed to verify the exact same resolution that would be committed,
 * not a separately-maintained copy that could silently drift.
 */
const PAYMENT_CATEGORY = 'លក់រាយ';
const DEPOSIT_CATEGORY = 'កក់ប្រាក់';

// Local calendar day, independent of time-of-day/timezone shifting — mirrors this
// codebase's own localDayOf/localYMD convention (never toISOString() for this).
function localDay(value) {
    if (!value) return '';
    const isoDateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
    if (isoDateOnly) return isoDateOnly[1];
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function amountsClose(a, b) {
    return Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;
}

// Returns { resolvedDeposit, resolvedPayment, unresolved } — each resolved
// entry is { t, sale, matchedOn } where matchedOn names which field made the
// amount match (for payments) so a spot-check can show its work.
function matchTransactionsToSales(transactions, sales) {
    const resolvedDeposit = [];
    const resolvedPayment = [];
    const unresolved = [];

    for (const t of transactions) {
        if (t.category === DEPOSIT_CATEGORY) {
            const m = /#DEP-(\S+)/.exec(t.description || '');
            if (!m) { unresolved.push({ t, reason: 'deposit row with no #DEP- marker (unexpected)' }); continue; }
            const fragment = m[1];
            const candidates = sales.filter(s => String(s.id).startsWith(fragment));
            if (candidates.length === 1) {
                resolvedDeposit.push({ t, sale: candidates[0], matchedOn: `#DEP- fragment "${fragment}"` });
            } else {
                unresolved.push({ t, reason: candidates.length === 0 ? 'no sale id starts with the #DEP- fragment (order likely deleted)' : `${candidates.length} sales match the #DEP- fragment (ambiguous)` });
            }
            continue;
        }

        // Payment-type: no marker. Narrow by exact trimmed name, then same local day,
        // then amount against whichever field it could represent.
        const name = (t.description || '').trim();
        const txDay = localDay(t.date);
        let candidates = sales.filter(s => (s.customer_snapshot?.name || '').trim() === name);
        candidates = candidates.filter(s => {
            const day = localDay(s.settle_date || s.deposit_date || s.date);
            return day && day === txDay;
        });
        let matchedOn = 'name + date';
        if (candidates.length > 1) {
            const byTotal = candidates.filter(s => amountsClose(t.amount, s.total));
            const byNet = candidates.filter(s => amountsClose(t.amount, Number(s.total || 0) - Number(s.deposit_amount || 0)));
            const byReceived = candidates.filter(s => amountsClose(t.amount, s.amount_received));
            if (byTotal.length) { candidates = byTotal; matchedOn = 'name + date + total'; }
            else if (byNet.length) { candidates = byNet; matchedOn = 'name + date + (total - deposit)'; }
            else if (byReceived.length) { candidates = byReceived; matchedOn = 'name + date + amount_received'; }
            else { candidates = []; }
        }
        if (candidates.length === 1) {
            resolvedPayment.push({ t, sale: candidates[0], matchedOn });
        } else {
            unresolved.push({ t, reason: candidates.length === 0 ? 'no sale matches name + date (+ amount)' : `${candidates.length} sales match name + date (ambiguous)` });
        }
    }

    return { resolvedDeposit, resolvedPayment, unresolved };
}

module.exports = { PAYMENT_CATEGORY, DEPOSIT_CATEGORY, localDay, amountsClose, matchTransactionsToSales };
