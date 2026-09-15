// DEV-ONLY fixture data for src/dev/dashboard2-preview.tsx.
//
// Lets the Dashboard2 view (src/pages/dashboard2/Dashboard2View.tsx) be
// rendered without a database or login. Nothing here is imported by the
// production app. The data is deliberately shaped to exercise every branch
// the dashboard has:
//   - every shipping status (Pending / Confirmed / Shipped / Delivered /
//     Cancelled / Returned / Drafted / ReStock) and every pay status;
//   - a "today" (Sep 7) with enough orders for a single-day range;
//   - two Pending orders of different ages (3 h and 30 h before fixtureNow);
//   - shipped/delivered J&T + VET orders with an EMPTY tracking number (the
//     missing-tracking alert) alongside in-house-driver orders that
//     legitimately have none;
//   - products at critical (≤ 5) / low (= threshold) / healthy stock;
//   - the longest real Khmer customer name, so wrapping can be checked.
// Everything is deterministic (no Math.random) so screenshots are repeatable.
import type { Sale, Product, CartItem } from '../types';

// ─── Ranges & clock ───────────────────────────────────────────────────────

export const fixtureRange = { start: '2026-09-01', end: '2026-09-07' };
export const fixturePreviousRange = { start: '2026-08-25', end: '2026-08-31' };

// "Now" used for pending-order ages: evening of the last day in range.
export const fixtureNow = new Date('2026-09-07T18:00:00+07:00');

// ─── Products ─────────────────────────────────────────────────────────────

const product = (
    id: string, name: string, model: string, price: number, stock: number,
    lowStockThreshold: number, category: 'Speaker' | 'Microphone',
): Product => ({
    id, name, model, price, stock, lowStockThreshold, image: '', category, isActive: true,
});

// Index positions are referenced by the order specs below (items: [index, qty]).
export const fixtureProducts: Product[] = [
    /*  0 */ product('1771290678217', 'BoomBest LN-716 Mic', 'LN-716', 18.5, 42, 5, 'Microphone'),
    /*  1 */ product('1771290678218', 'M-206 Wireless Mic', 'M-206', 12, 2, 5, 'Microphone'),        // critical
    /*  2 */ product('1771290678219', 'M-27 Karaoke Mic', 'M-27', 9.5, 65, 5, 'Microphone'),
    /*  3 */ product('1771290678220', 'NR-6012 Speaker', 'NR-6012', 45, 10, 10, 'Speaker'),          // low (= threshold)
    /*  4 */ product('1771290678221', 'NR-8801 Speaker', 'NR-8801', 62, 28, 5, 'Speaker'),
    /*  5 */ product('1771290678222', 'WUF-107K Mic', 'WUF-107K', 15, 0, 5, 'Microphone'),           // critical (out of stock)
    /*  6 */ product('1771290678223', 'JBL Flip 6', 'Flip 6', 89, 10, 10, 'Speaker'),                // low (= threshold)
    /*  7 */ product('1771290678224', 'ZQS-6201 Speaker', 'ZQS-6201', 55, 36, 5, 'Speaker'),
    /*  8 */ product('1771290678225', 'ZQS-4239 Speaker', 'ZQS-4239', 38, 120, 5, 'Speaker'),
    /*  9 */ product('1771290678226', 'KTS-1195 Speaker', 'KTS-1195', 32, 48, 5, 'Speaker'),
    /* 10 */ product('1771290678227', 'SDRD SD-306 Mic', 'SD-306', 22, 25, 5, 'Microphone'),
    /* 11 */ product('1771290678228', 'Kimiso QS-4820', 'QS-4820', 48, 33, 5, 'Speaker'),
    /* 12 */ product('1771290678229', 'BoomBest LN-8 Mic', 'LN-8', 16.5, 57, 5, 'Microphone'),
    /* 13 */ product('1771290678230', 'JBL Partybox 110', 'Partybox 110', 320, 26, 5, 'Speaker'),
];

// ─── Reference values ─────────────────────────────────────────────────────

type ShippingStatus = NonNullable<Sale['shipping']>['status'];
type PayStatus = NonNullable<Sale['paymentStatus']>;

const JT = 'J&T';
const DRIVER = 'អ្នកដឹក';          // in-house driver — never has a tracking number
const VET = 'VET';
const TORO = 'Toro Express';

const S1 = 'ស៊ី លីហ្សា';
const S2 = 'ម៉ឹង វិជ្ជនី';
const S3 = 'សុខ ចាន់ណា';

const PG1 = 'រំដួល ស្ពិកឃ័រ';
const PG2 = 'CH Sound';
const PG3 = 'ពិភព ស្ពិកឃ័រ';

// Longest real customer name in the data set (spec: wrapping test case).
const LONG = 'បងតុលា មានសេវាកម្មជួលឡានគ្រប់ប្រភេទ តាមរោងចក្រនិងក្រុមហ៊ុន';

// Customer name → phone. Same name always maps to the same phone.
const CUSTOMERS: Record<string, string> = {
    [LONG]: '012 888 168',
    'សុភា': '096 234 5678',
    'បង ដារ៉ា': '011 456 789',
    'អ្នកមីង សុខា': '070 987 654',
    'ចាន់ សុផល': '017 321 654',
    'បងស្រី លីដា': '015 765 432',
    'ពូ វណ្ណា': '093 112 233',
    'នាង ស្រីមុំ': '086 445 566',
    'លោក ប៊ុនធឿន': '012 778 899',
    'ម៉ាក់ ស្រីពៅ': '069 334 455',
    'បង រតនា': '010 556 677',
    'អ៊ុំ ចន្ធី': '077 889 900',
    'កញ្ញា ម៉ាលីស': '099 223 344',
    'បង ពិសិដ្ឋ': '081 667 788',
    'ថា វីរៈ': '092 990 011',
    'ហេង សុខហេង': '016 123 987',
    'ស្រី ណារី': '071 654 321',
    'បង សុវណ្ណ': '097 543 210',
    'លោកគ្រូ ចាន់ថន': '012 246 810',
    'នាង បូផា': '088 135 791',
    'ពូ សារឿន': '078 864 209',
    'មីង សុភ័ក្ត្រ': '095 975 310',
    'បង វុទ្ធី': '011 802 468',
    'អ្នកស្រី ចាន់ណា': '017 913 579',
    'Sokha Chan': '012 300 400',
    'Dara Kim': '096 500 600',
    'Vannak Lim': '070 700 800',
    'Kimheng Ly': '015 900 100',
    'Sreypov Sok': '093 200 300',
};

const CITIES = ['ភ្នំពេញ', 'សៀមរាប', 'បាត់ដំបង', 'កំពង់ចាម', 'តាកែវ'];

// ─── Order builder ────────────────────────────────────────────────────────

interface OrderSpec {
    day: string;                       // 'MM-DD' (year is always 2026)
    time: string;                      // 'HH:MM' local (+07:00)
    status: ShippingStatus;
    pay: PayStatus;
    courier: string;
    // undefined → auto-generated for external couriers once the parcel has
    // left (Shipped/Delivered/Returned/ReStock); '' → explicitly missing.
    tracking?: string;
    salesman: string;
    page: string;
    customer: string;                  // key into CUSTOMERS
    items: Array<[productIndex: number, qty: number]>;
    shippingCost?: number;             // what the shop pays the courier
    deposit?: number;                  // upfront deposit (pay === 'Deposit')
    method?: Sale['paymentMethod'];    // default 'COD'
}

const LEFT_WAREHOUSE = new Set<ShippingStatus>(['Shipped', 'Delivered', 'Returned', 'ReStock']);
const CLOSED = new Set<ShippingStatus>(['Delivered', 'Cancelled', 'Returned', 'ReStock']);

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Deterministic, realistic-looking waybill numbers per courier.
const autoTracking = (courier: string, seq: number): string => {
    if (courier === JT) return `JT${8801234500 + seq * 173}`;
    if (courier === VET) return `VET${20260900 + seq * 41}`;
    if (courier === TORO) return `TE${5500100 + seq * 7}`;
    return '';
};

const buildOrder = (spec: OrderSpec, seq: number): Sale => {
    const date = `2026-${spec.day}T${spec.time}:00+07:00`;
    const items: CartItem[] = spec.items.map(([idx, quantity]) => ({ ...fixtureProducts[idx], quantity }));
    const total = round2(items.reduce((s, it) => s + it.price * it.quantity, 0));
    const deposit = spec.pay === 'Deposit' ? (spec.deposit ?? 10) : 0;
    const amountReceived = spec.pay === 'Paid' ? total : deposit;

    const external = spec.courier !== '' && spec.courier !== DRIVER;
    const trackingNumber = spec.tracking !== undefined
        ? spec.tracking
        : (external && LEFT_WAREHOUSE.has(spec.status) ? autoTracking(spec.courier, seq) : '');

    return {
        id: String(1757211000000 + seq * 4271),
        orderIndex: seq,
        items,
        total,
        date,
        discount: 0,
        paymentMethod: spec.method ?? 'COD',
        type: 'Online',
        salesman: spec.salesman,
        amountReceived,
        settleDate: spec.pay === 'Paid' ? date : undefined,
        depositAmount: deposit,
        depositDate: deposit > 0 ? date : undefined,
        depositMethod: deposit > 0 ? 'ABA' : undefined,
        paymentStatus: spec.pay,
        orderStatus: CLOSED.has(spec.status) ? 'Closed' : 'Open',
        pageSource: spec.page,
        isPrinted: LEFT_WAREHOUSE.has(spec.status),
        customer: {
            name: spec.customer,
            phone: CUSTOMERS[spec.customer] ?? '',
            city: CITIES[seq % CITIES.length],
            platform: 'Facebook',
            page: spec.page,
        },
        shipping: {
            company: spec.courier,
            trackingNumber,
            status: spec.status,
            cost: spec.shippingCost ?? 0,
            staffName: '',
        },
    };
};

const buildOrders = (specs: OrderSpec[], firstSeq: number): Sale[] =>
    specs.map((spec, i) => buildOrder(spec, firstSeq + i));

// Compact spec constructor so the tables below stay one line per order.
const o = (
    day: string, time: string, status: ShippingStatus, pay: PayStatus, courier: string,
    salesman: string, page: string, customer: string, items: OrderSpec['items'],
    extra: Partial<Pick<OrderSpec, 'tracking' | 'shippingCost' | 'deposit' | 'method'>> = {},
): OrderSpec => ({ day, time, status, pay, courier, salesman, page, customer, items, ...extra });

const NO_TRACKING = { tracking: '' } as const;

// ─── Current range: Sep 1–7, 2026 (45 orders) ─────────────────────────────
//
// Status: Pending 2 · Confirmed 5 · Shipped 22 · Delivered 10 · Cancelled 3 ·
//         Returned 1 · Drafted 1 · ReStock 1
// Pay:    Unpaid 28 · Paid 8 · Deposit 3 · Get File 2 · Cancel 4
// Courier: J&T 33 (4 shipped/delivered with no tracking) · អ្នកដឹក 8 ·
//          VET 3 (2 with no tracking) · Toro Express 1
const CURRENT_SPECS: OrderSpec[] = [
    // Sep 1 (5)
    o('09-01', '08:40', 'Delivered', 'Paid', JT, S1, PG1, 'Sokha Chan', [[7, 1]], { shippingCost: 1.5, method: 'Bank Transfer' }),
    o('09-01', '09:55', 'Delivered', 'Paid', JT, S2, PG2, 'សុភា', [[0, 2], [2, 1]]),
    o('09-01', '11:20', 'Delivered', 'Unpaid', DRIVER, S1, PG1, 'បង ដារ៉ា', [[3, 1]]),
    o('09-01', '14:05', 'Delivered', 'Unpaid', JT, S3, PG3, 'អ្នកមីង សុខា', [[8, 1], [1, 1]], NO_TRACKING),   // missing tracking
    o('09-01', '16:30', 'Cancelled', 'Cancel', JT, S2, PG1, 'ចាន់ សុផល', [[13, 1]]),
    // Sep 2 (6)
    o('09-02', '08:15', 'Delivered', 'Paid', JT, S1, PG2, 'បងស្រី លីដា', [[6, 1]], { shippingCost: 1, method: 'QR' }),
    o('09-02', '09:40', 'Delivered', 'Unpaid', DRIVER, S3, PG1, LONG, [[4, 2]]),
    o('09-02', '10:50', 'Shipped', 'Unpaid', JT, S2, PG3, 'ពូ វណ្ណា', [[9, 1]]),
    o('09-02', '13:10', 'Delivered', 'Get File', JT, S1, PG1, 'Dara Kim', [[11, 1], [12, 1]]),
    o('09-02', '15:25', 'Returned', 'Unpaid', JT, S2, PG2, 'នាង ស្រីមុំ', [[7, 1]]),
    o('09-02', '17:45', 'Shipped', 'Unpaid', VET, S3, PG3, 'លោក ប៊ុនធឿន', [[8, 2]], NO_TRACKING),           // missing tracking
    // Sep 3 (6)
    o('09-03', '08:30', 'Delivered', 'Paid', JT, S1, PG1, 'ម៉ាក់ ស្រីពៅ', [[0, 1], [1, 1], [2, 1]]),
    o('09-03', '10:05', 'Shipped', 'Unpaid', JT, S2, PG1, 'បង រតនា', [[3, 1]], { shippingCost: 2 }),
    o('09-03', '11:15', 'Shipped', 'Deposit', JT, S3, PG2, 'អ៊ុំ ចន្ធី', [[13, 1]], { deposit: 15 }),
    o('09-03', '13:40', 'Delivered', 'Unpaid', JT, S1, PG3, 'កញ្ញា ម៉ាលីស', [[10, 1]], NO_TRACKING),       // missing tracking
    o('09-03', '15:00', 'Shipped', 'Unpaid', DRIVER, S2, PG1, 'Vannak Lim', [[6, 1]]),
    o('09-03', '16:50', 'ReStock', 'Cancel', JT, S3, PG2, 'បង ពិសិដ្ឋ', [[9, 1]]),
    // Sep 4 (6)
    o('09-04', '08:05', 'Shipped', 'Unpaid', JT, S1, PG1, 'ថា វីរៈ', [[7, 1], [2, 2]]),
    o('09-04', '09:30', 'Shipped', 'Paid', JT, S2, PG2, 'ហេង សុខហេង', [[11, 1]], { method: 'Bank Transfer' }),
    o('09-04', '11:00', 'Shipped', 'Unpaid', VET, S3, PG3, 'ស្រី ណារី', [[8, 1]]),
    o('09-04', '12:45', 'Delivered', 'Unpaid', DRIVER, S1, PG1, 'បង សុវណ្ណ', [[4, 1]]),
    o('09-04', '14:20', 'Shipped', 'Unpaid', JT, S2, PG1, 'លោកគ្រូ ចាន់ថន', [[12, 3]]),
    o('09-04', '17:10', 'Cancelled', 'Cancel', JT, S3, PG2, 'នាង បូផា', [[6, 1]]),
    // Sep 5 (7)
    o('09-05', '08:20', 'Shipped', 'Unpaid', JT, S1, PG3, 'ពូ សារឿន', [[3, 1]], { shippingCost: 1.5 }),
    o('09-05', '09:45', 'Shipped', 'Unpaid', JT, S2, PG1, 'មីង សុភ័ក្ត្រ', [[0, 1]], NO_TRACKING),         // missing tracking
    o('09-05', '10:30', 'Shipped', 'Deposit', JT, S3, PG2, 'Kimheng Ly', [[13, 1]], { deposit: 20 }),
    o('09-05', '12:00', 'Shipped', 'Unpaid', DRIVER, S1, PG1, 'បង វុទ្ធី', [[9, 2]]),
    o('09-05', '13:35', 'Shipped', 'Paid', JT, S2, PG3, 'អ្នកស្រី ចាន់ណា', [[1, 2], [2, 2]], { method: 'QR' }),
    o('09-05', '15:15', 'Confirmed', 'Unpaid', JT, S3, PG1, 'Sreypov Sok', [[11, 1]]),
    o('09-05', '16:40', 'Shipped', 'Get File', TORO, S1, PG2, 'សុភា', [[7, 1]]),
    // Sep 6 (6)
    o('09-06', '08:10', 'Confirmed', 'Unpaid', JT, S2, PG1, 'បង ដារ៉ា', [[8, 1]]),
    o('09-06', '09:35', 'Shipped', 'Unpaid', DRIVER, S1, PG2, LONG, [[4, 1], [0, 1]]),
    o('09-06', '11:05', 'Shipped', 'Unpaid', VET, S3, PG3, 'ចាន់ សុផល', [[10, 2]], NO_TRACKING),           // missing tracking
    o('09-06', '12:00', 'Pending', 'Unpaid', JT, S2, PG1, 'បងស្រី លីដា', [[6, 1]]),                         // 30 h before fixtureNow
    o('09-06', '14:25', 'Shipped', 'Paid', JT, S1, PG1, 'ពូ វណ្ណា', [[3, 1]], { shippingCost: 2.5 }),
    o('09-06', '16:15', 'Confirmed', 'Unpaid', JT, S3, PG2, 'នាង ស្រីមុំ', [[12, 1], [2, 1]]),
    // Sep 7 (9) — "today"
    o('09-07', '08:00', 'Shipped', 'Unpaid', DRIVER, S1, PG1, 'លោក ប៊ុនធឿន', [[7, 1]]),
    o('09-07', '08:45', 'Shipped', 'Paid', JT, S2, PG3, 'ម៉ាក់ ស្រីពៅ', [[11, 1]], { method: 'Bank Transfer' }),
    o('09-07', '09:15', 'Shipped', 'Unpaid', JT, S3, PG1, 'បង រតនា', [[9, 1]], NO_TRACKING),               // missing tracking
    o('09-07', '10:30', 'Confirmed', 'Unpaid', JT, S1, PG2, 'អ៊ុំ ចន្ធី', [[1, 1]]),
    o('09-07', '11:20', 'Shipped', 'Unpaid', DRIVER, S2, PG1, 'កញ្ញា ម៉ាលីស', [[8, 1], [2, 1]]),
    o('09-07', '12:40', 'Confirmed', 'Unpaid', JT, S3, PG3, 'Vannak Lim', [[13, 1]]),
    o('09-07', '13:55', 'Cancelled', 'Cancel', JT, S1, PG1, 'ថា វីរៈ', [[6, 1]]),
    o('09-07', '15:00', 'Pending', 'Deposit', JT, S2, PG2, 'ហេង សុខហេង', [[4, 1]], { deposit: 10 }),      // 3 h before fixtureNow
    o('09-07', '16:35', 'Drafted', 'Unpaid', JT, S3, PG1, 'ស្រី ណារី', [[0, 1], [12, 1]]),
];

// ─── Previous range: Aug 25–31, 2026 (30 orders) ──────────────────────────
//
// Mostly settled by now (Delivered), a little smaller than the current week so
// every "vs previous" delta is non-zero.
// Pay: Unpaid 19 · Paid 6 · Deposit 2 · Get File 1 · Cancel 2
const PREVIOUS_SPECS: OrderSpec[] = [
    // Aug 25 (4)
    o('08-25', '08:30', 'Delivered', 'Paid', JT, S1, PG1, 'Sokha Chan', [[7, 1]], { shippingCost: 1.5, method: 'Bank Transfer' }),
    o('08-25', '10:10', 'Delivered', 'Unpaid', JT, S2, PG2, 'បង ដារ៉ា', [[0, 1], [2, 1]]),
    o('08-25', '13:20', 'Delivered', 'Unpaid', DRIVER, S3, PG1, 'អ្នកមីង សុខា', [[3, 1]]),
    o('08-25', '16:00', 'Cancelled', 'Cancel', JT, S1, PG3, 'ចាន់ សុផល', [[6, 1]]),
    // Aug 26 (4)
    o('08-26', '09:00', 'Delivered', 'Paid', JT, S2, PG1, 'បងស្រី លីដា', [[8, 1]], { method: 'QR' }),
    o('08-26', '10:45', 'Delivered', 'Unpaid', JT, S3, PG2, LONG, [[4, 1]]),
    o('08-26', '12:30', 'Delivered', 'Unpaid', JT, S1, PG1, 'ពូ វណ្ណា', [[9, 1], [12, 1]]),
    o('08-26', '15:10', 'Delivered', 'Deposit', JT, S2, PG3, 'Dara Kim', [[13, 1]], { deposit: 15 }),
    // Aug 27 (5)
    o('08-27', '08:20', 'Delivered', 'Unpaid', DRIVER, S3, PG1, 'នាង ស្រីមុំ', [[7, 1]]),
    o('08-27', '09:50', 'Delivered', 'Paid', JT, S1, PG2, 'លោក ប៊ុនធឿន', [[1, 2]]),
    o('08-27', '11:30', 'Delivered', 'Unpaid', JT, S2, PG1, 'ម៉ាក់ ស្រីពៅ', [[11, 1]], { shippingCost: 1 }),
    o('08-27', '14:15', 'Returned', 'Unpaid', JT, S3, PG3, 'បង រតនា', [[3, 1]]),
    o('08-27', '16:40', 'Delivered', 'Unpaid', VET, S1, PG1, 'អ៊ុំ ចន្ធី', [[10, 1], [2, 1]]),
    // Aug 28 (4)
    o('08-28', '08:45', 'Delivered', 'Unpaid', JT, S2, PG2, 'កញ្ញា ម៉ាលីស', [[8, 2]]),
    o('08-28', '10:20', 'Delivered', 'Paid', JT, S3, PG1, 'Vannak Lim', [[6, 1]], { method: 'Bank Transfer' }),
    o('08-28', '13:05', 'Delivered', 'Unpaid', DRIVER, S1, PG3, 'បង ពិសិដ្ឋ', [[4, 1]]),
    o('08-28', '15:50', 'Delivered', 'Unpaid', JT, S2, PG1, 'ថា វីរៈ', [[0, 2]]),
    // Aug 29 (5)
    o('08-29', '08:10', 'Delivered', 'Unpaid', JT, S3, PG2, 'ហេង សុខហេង', [[9, 1]]),
    o('08-29', '09:40', 'Delivered', 'Get File', JT, S1, PG1, 'ស្រី ណារី', [[12, 2], [2, 1]]),
    o('08-29', '11:25', 'Cancelled', 'Cancel', JT, S2, PG3, 'បង សុវណ្ណ', [[13, 1]]),
    o('08-29', '13:50', 'Delivered', 'Paid', JT, S3, PG1, 'លោកគ្រូ ចាន់ថន', [[7, 1]], { shippingCost: 2 }),
    o('08-29', '16:20', 'Delivered', 'Unpaid', DRIVER, S1, PG2, 'នាង បូផា', [[11, 1]]),
    // Aug 30 (4)
    o('08-30', '08:35', 'Delivered', 'Unpaid', JT, S2, PG1, 'ពូ សារឿន', [[3, 1]]),
    o('08-30', '10:00', 'Shipped', 'Unpaid', JT, S3, PG3, 'មីង សុភ័ក្ត្រ', [[8, 1]]),
    o('08-30', '12:15', 'Delivered', 'Deposit', JT, S1, PG1, 'Kimheng Ly', [[6, 1]], { deposit: 10 }),
    o('08-30', '15:30', 'Delivered', 'Unpaid', VET, S2, PG2, 'បង វុទ្ធី', [[1, 1], [5, 1]]),
    // Aug 31 (4)
    o('08-31', '08:50', 'Shipped', 'Unpaid', JT, S3, PG1, 'អ្នកស្រី ចាន់ណា', [[10, 1]]),
    o('08-31', '10:30', 'Delivered', 'Paid', JT, S1, PG3, 'Sreypov Sok', [[4, 1]], { method: 'QR' }),
    o('08-31', '13:10', 'Shipped', 'Unpaid', DRIVER, S2, PG1, 'សុភា', [[9, 1]]),
    o('08-31', '16:45', 'Shipped', 'Unpaid', JT, S3, PG2, 'បង ដារ៉ា', [[0, 1], [12, 1]]),
];

// Sequence numbers are disjoint between the two sets so ids / waybills never collide.
export const fixturePreviousOrders: Sale[] = buildOrders(PREVIOUS_SPECS, 100);
export const fixtureOrders: Sale[] = buildOrders(CURRENT_SPECS, 200);
