// Sales Setup › Defaults › Payment request message: the text staff copy from
// an order (Order Details › Copy payment request) and paste into Telegram /
// Messenger to ask the customer to pay (app_config
// salesSettings.paymentRequestMessage; the default below until a store saves
// its own). Fields in {braces} are filled from the order. Pure helpers so the
// rules are unit-tested (tests/payment-request.test.mjs).
import type { Sale } from '../types';
import { roundCents } from './money';
import { usdToKhr } from './currency';

export const MAX_PAYMENT_REQUEST_LENGTH = 1000;

// The fields a message can use, in the order Sales Setup lists them.
export const PAYMENT_REQUEST_FIELDS = ['name', 'phone', 'order', 'date', 'items', 'total', 'paid', 'due', 'dueKhr', 'page', 'store'] as const;
export type PaymentRequestField = typeof PAYMENT_REQUEST_FIELDS[number];

export const DEFAULT_PAYMENT_REQUEST_MESSAGE = [
    'Hello {name},',
    'Thank you for your order #{order} ({date}):',
    '{items}',
    'Total: {total}',
    'Paid: {paid}',
    'Amount to pay: {due} ({dueKhr})',
    'Please send the payment and a photo of the receipt. Thank you! - {store}',
].join('\n');

// The template in use: the saved one, or the default while none is saved.
export const paymentRequestTemplate = (saved: unknown): string =>
    typeof saved === 'string' && saved.trim() ? saved : DEFAULT_PAYMENT_REQUEST_MESSAGE;

// What the Defaults editor saves for the text typed: '' (back to the default)
// when it is empty or the default itself, else the text; null when too long.
// The text as saved (line breaks normalised, ends trimmed): its length is
// the one the editor checks.
export const paymentRequestText = (typed: string): string => typed.replace(/\r\n/g, '\n').trim();

export const paymentRequestInput = (typed: string): string | null => {
    const s = paymentRequestText(typed);
    if (s.length > MAX_PAYMENT_REQUEST_LENGTH) return null;
    return s === '' || s === DEFAULT_PAYMENT_REQUEST_MESSAGE ? '' : s;
};

// The {fields} a template uses that aren't known (a typo such as {nmae}):
// copied as typed, so the editor warns about them.
export const unknownPaymentRequestFields = (template: string): string[] => {
    const known = new Set<string>(PAYMENT_REQUEST_FIELDS);
    const out: string[] = [];
    for (const m of template.matchAll(/\{([A-Za-z]+)\}/g)) {
        if (!known.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
};

// A Salesman's payment claim still waiting to be confirmed (the order is
// still Unpaid; Orders shows it in grey): the customer says they paid it, so
// the request must not ask for it again.
export const pendingClaimPaid = (order: Sale): number => {
    const c = order.paymentClaim;
    if (!c || (order.paymentStatus || 'Unpaid') !== 'Unpaid') return 0;
    const total = Number(order.total) || 0;
    return roundCents(c.status === 'Paid' ? total : Math.min(total, Math.max(0, Number(c.amount) || 0)));
};

// The dollars already paid on an order: all of it once Paid (or a Get File
// the courier settled), else what was taken (receipt, or the deposit), or a
// pending claim's amount.
export const paymentRequestPaid = (order: Sale): number => {
    const total = Number(order.total) || 0;
    if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Get File') return roundCents(total);
    const booked = Math.max(0, Number(order.amountReceived) || Number(order.depositAmount) || 0);
    return roundCents(Math.min(total, Math.max(booked, pendingClaimPaid(order))));
};

// The dollars still to ask for. Nothing on an order that is voided
// (Cancelled / Returned / ReStock, or paid Cancel / PdFee): there is nothing
// to collect. Unlike orderBalance (the Dashboard's "Owed"), a Pending or
// Drafted order does owe here: asking before shipping is the point.
export const paymentRequestDue = (order: Sale): number => {
    const s = order.shipping?.status;
    if (s === 'Cancelled' || s === 'Returned' || s === 'ReStock') return 0;
    if (order.paymentStatus === 'Cancel' || order.paymentStatus === 'PdFee') return 0;
    return roundCents(Math.max(0, (Number(order.total) || 0) - paymentRequestPaid(order)));
};

// How far (share of the dollars due) the order's saved riel may be from the
// dollars due at today's shop rate and still be the riel asked for.
export const SAVED_RIEL_TOLERANCE = 0.05;

const usd = (n: number) => '$' + roundCents(n).toFixed(2);
const pad2 = (n: number) => String(n).padStart(2, '0');
const dayText = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
};

// The values every {field} is filled with for an order.
export const paymentRequestValues = (order: Sale, o: { orderNo: number | string; storeName?: string; khrRate: number }): Record<PaymentRequestField, string> => {
    const due = paymentRequestDue(order);
    const paid = paymentRequestPaid(order);
    // The order's saved riel (customKhrAmount) is what its receipt prints and
    // the customer was told: the riel price, or with a deposit the riel still
    // owed (CheckoutForm / Select Shipping save it so). A pending claim isn't
    // in it, nor is a later part-payment, nor a deposit booked from Orders
    // (that leaves the saved riel as it was): the saved riel is used only
    // while it still matches the dollars due at the shop rate (within
    // SAVED_RIEL_TOLERANCE: a rate change since, a hand-typed riel), else
    // the dollars due are converted.
    const savedRiel = Number(order.customKhrAmount);
    const savedUsd = o.khrRate > 0 ? savedRiel / o.khrRate : 0;
    const savedMatches = order.customKhrAmount != null && savedRiel > 0 && due > 0
        && Math.abs(savedUsd - due) <= due * SAVED_RIEL_TOLERANCE;
    const khrDue = pendingClaimPaid(order) === 0 && savedMatches ? Math.round(savedRiel) : usdToKhr(due, o.khrRate);
    return {
        name: (order.customer?.name || '').trim(),
        phone: (order.customer?.phone || '').trim(),
        order: typeof o.orderNo === 'number' ? pad2(o.orderNo) : String(o.orderNo),
        date: dayText(order.date),
        items: (order.items || []).map(i => `- ${i.name} x${i.quantity} (${usd((Number(i.price) || 0) * (Number(i.quantity) || 0))})`).join('\n'),
        total: usd(Number(order.total) || 0),
        paid: usd(paid),
        due: usd(due),
        dueKhr: '៛' + khrDue.toLocaleString('en-US'),
        page: (order.customer?.page || order.pageSource || '').trim(),
        store: (o.storeName || '').trim(),
    };
};

// The template with each known {field} filled in; anything else is kept as typed.
export const fillPaymentRequest = (template: string, values: Record<string, string>): string =>
    template.replace(/\{([A-Za-z]+)\}/g, (whole, key: string) =>
        Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole);
