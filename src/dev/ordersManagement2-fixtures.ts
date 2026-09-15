// DEV-ONLY fixture data for src/dev/ordersManagement2-preview.tsx.
//
// Lets the Orders Management 2 view be rendered without a database or login.
// Nothing here is imported by the production app. Forty orders, all dated
// "today" (Sep 8, 2026), deliberately shaped to exercise every branch the
// page reads:
//   - every shipping status: Drafted 2 / Pending 2 / Confirmed 14 /
//     Shipped 16 / Delivered 3 / Cancelled 3;
//   - every paymentStatus: mostly Unpaid, 5 Deposit (each with a dollar
//     amount), 3 Paid, 2 Get File, 1 Cancel;
//   - couriers: J&T (29, the majority — mixed tracking presence), the
//     in-house driver (7, never flagged even with no tracking number), and
//     VET (4);
//   - 4 Shipped orders on an external courier (J&T/VET) with an EMPTY
//     tracking number — the "no tracking" alert — alongside plenty of
//     Shipped/Delivered orders that do have one;
//   - the longest real Khmer customer name, to check truncation.
// Everything is deterministic (no Math.random / Date.now) so the preview is
// repeatable.
import type { Sale, CartItem } from '../types';

// ─── "Now" — today, mid-afternoon ──────────────────────────────────────────

export const fixtureNow = new Date('2026-09-08T16:00:00+07:00');

// ─── Products (name/model/price only — enough to build order line items) ──

interface Item { name: string; model: string; price: number }

const ITEMS: Item[] = [
    /* 0 */ { name: 'BoomBest LN-716 Mic', model: 'LN-716', price: 18.5 },
    /* 1 */ { name: 'M-206 Wireless Mic', model: 'M-206', price: 12 },
    /* 2 */ { name: 'M-27 Karaoke Mic', model: 'M-27', price: 9.5 },
    /* 3 */ { name: 'NR-6012 Speaker', model: 'NR-6012', price: 45 },
    /* 4 */ { name: 'NR-8801 Speaker', model: 'NR-8801', price: 62 },
    /* 5 */ { name: 'JBL Flip 6', model: 'Flip 6', price: 89 },
    /* 6 */ { name: 'ZQS-6201 Speaker', model: 'ZQS-6201', price: 55 },
    /* 7 */ { name: 'ZQS-4239 Speaker', model: 'ZQS-4239', price: 38 },
    /* 8 */ { name: 'KTS-1195 Speaker', model: 'KTS-1195', price: 32 },
    /* 9 */ { name: 'JBL Partybox 110', model: 'Partybox 110', price: 320 },
];

const item = (idx: number, quantity: number): CartItem => ({
    id: `item-${idx}`,
    name: ITEMS[idx].name,
    model: ITEMS[idx].model,
    price: ITEMS[idx].price,
    stock: 999,
    image: '',
    category: idx >= 3 ? 'Speaker' : 'Microphone',
    isActive: true,
    quantity,
});

// ─── Reference values ───────────────────────────────────────────────────────

type ShippingStatus = NonNullable<Sale['shipping']>['status'];
type PayStatus = NonNullable<Sale['paymentStatus']>;

const JT = 'J&T';
const DRIVER = 'អ្នកដឹក';           // in-house driver — never has a tracking number, never flagged
const VET = 'VET';

export const fixtureShippingCompanies: string[] = [JT, DRIVER, VET];

const S1 = 'ស៊ី លីហ្សា';
const S2 = 'ម៉ឹង វិជ្ជនី';
const S3 = 'សុខ ចាន់ណា';

export const fixtureSalesmen: string[] = [S1, S2, S3];

const PG1 = 'រំដួល ស្ពិកឃ័រ';
const PG2 = 'CH Sound';
const PG3 = 'ពិភព ស្ពិកឃ័រ';

export const fixturePageSources: string[] = [PG1, PG2, PG3];

// Longest real customer name in the data set (spec: truncation/wrapping test case).
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
const STAFF = ['សុខ អាដមីន', 'ដារ៉ា វេចខ្ចប់'];

// ─── Order spec / builder ───────────────────────────────────────────────────

interface OrderSpec {
    time: string;                      // 'HH:MM' local (+07:00), today
    status: ShippingStatus;
    pay: PayStatus;
    courier: string;
    // undefined → auto-generated for an external courier once the parcel has
    // shipped (Shipped/Delivered); '' → explicitly missing (the alert case).
    tracking?: string;
    salesman: string;
    page: string;
    customer: string;                  // key into CUSTOMERS
    items: Array<[itemIndex: number, qty: number]>;
    shippingCost?: number;             // what the shop pays the courier
    deposit?: number;                  // upfront deposit (pay === 'Deposit')
    method?: Sale['paymentMethod'];    // default 'COD'
    remark?: string;
}

const LEFT_WAREHOUSE = new Set<ShippingStatus>(['Shipped', 'Delivered']);
const CLOSED = new Set<ShippingStatus>(['Delivered', 'Cancelled']);

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Deterministic, realistic-looking waybill numbers per courier.
const autoTracking = (courier: string, seq: number): string => {
    if (courier === JT) return `JT${8801234500 + seq * 173}`;
    if (courier === VET) return `VET${20260900 + seq * 41}`;
    return '';
};

const buildOrder = (spec: OrderSpec, seq: number): Sale => {
    const date = `2026-09-08T${spec.time}:00+07:00`;
    const items = spec.items.map(([idx, quantity]) => item(idx, quantity));
    const total = round2(items.reduce((s, it) => s + it.price * it.quantity, 0));
    const deposit = spec.pay === 'Deposit' ? (spec.deposit ?? 10) : 0;
    const amountReceived = spec.pay === 'Paid' ? total : deposit;

    const external = spec.courier !== '' && spec.courier !== DRIVER;
    const trackingNumber = spec.tracking !== undefined
        ? spec.tracking
        : (external && LEFT_WAREHOUSE.has(spec.status) ? autoTracking(spec.courier, seq) : '');

    return {
        id: String(1757308800000 + seq * 4271),
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
        lastEditedAt: date,
        lastEditedBy: STAFF[seq % STAFF.length],
        remark: spec.remark ?? '',
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
            staffName: STAFF[seq % STAFF.length],
        },
    };
};

// Compact spec constructor so the table below stays one line per order.
const o = (
    time: string, status: ShippingStatus, pay: PayStatus, courier: string,
    salesman: string, page: string, customer: string, items: OrderSpec['items'],
    extra: Partial<Pick<OrderSpec, 'tracking' | 'shippingCost' | 'deposit' | 'method' | 'remark'>> = {},
): OrderSpec => ({ time, status, pay, courier, salesman, page, customer, items, ...extra });

const NO_TRACKING = { tracking: '' } as const;

// ─── Today: Sep 8, 2026 (40 orders) ─────────────────────────────────────────
//
// Status:  Delivered 3 · Shipped 16 · Confirmed 14 · Cancelled 3 · Pending 2 · Drafted 2
// Pay:     Unpaid 29 · Deposit 5 · Paid 3 · Get File 2 · Cancel 1
// Courier: J&T 29 (4 Shipped with no tracking) · អ្នកដឹក 7 (never flagged) · VET 4
const SPECS: OrderSpec[] = [
    // ── Delivered (3) — already picked up, all carry a tracking number ──
    o('08:05', 'Delivered', 'Paid', JT, S1, PG1, 'Sokha Chan', [[7, 1]], { shippingCost: 1.5, method: 'Bank Transfer' }),
    o('08:20', 'Delivered', 'Paid', JT, S2, PG2, 'សុភា', [[0, 2], [2, 1]], { method: 'QR' }),
    o('08:40', 'Delivered', 'Get File', DRIVER, S3, PG3, 'អ្នកមីង សុខា', [[3, 1]]),

    // ── Shipped (16) — 4 missing tracking on an external courier (alert), rest tracked or own-driver ──
    o('09:00', 'Shipped', 'Unpaid', JT, S1, PG1, 'បង ដារ៉ា', [[8, 1], [1, 1]]),
    o('09:15', 'Shipped', 'Paid', JT, S2, PG2, 'ចាន់ សុផល', [[6, 1]], { method: 'Bank Transfer' }),
    o('09:30', 'Shipped', 'Unpaid', JT, S3, PG3, 'បងស្រី លីដា', [[9, 1]], NO_TRACKING),                     // missing tracking
    o('09:45', 'Shipped', 'Unpaid', DRIVER, S1, PG1, LONG, [[4, 1]]),
    o('10:00', 'Shipped', 'Unpaid', VET, S2, PG2, 'ពូ វណ្ណា', [[7, 1]], { shippingCost: 2 }),
    o('10:15', 'Shipped', 'Unpaid', VET, S3, PG3, 'នាង ស្រីមុំ', [[8, 2]], NO_TRACKING),                    // missing tracking
    o('10:30', 'Shipped', 'Unpaid', DRIVER, S1, PG1, 'លោក ប៊ុនធឿន', [[2, 3]]),
    o('10:45', 'Shipped', 'Unpaid', JT, S2, PG2, 'ម៉ាក់ ស្រីពៅ', [[0, 1], [1, 1]]),
    o('11:00', 'Shipped', 'Unpaid', JT, S3, PG3, 'បង រតនា', [[3, 1]], NO_TRACKING),                         // missing tracking
    o('11:15', 'Shipped', 'Deposit', JT, S1, PG1, 'អ៊ុំ ចន្ធី', [[9, 1]], { deposit: 15, shippingCost: 3 }),
    o('11:30', 'Shipped', 'Unpaid', DRIVER, S2, PG2, 'កញ្ញា ម៉ាលីស', [[6, 1]]),
    o('11:45', 'Shipped', 'Unpaid', JT, S3, PG3, 'បង ពិសិដ្ឋ', [[1, 2], [2, 2]]),
    o('12:00', 'Shipped', 'Unpaid', JT, S1, PG1, 'ថា វីរៈ', [[4, 1]], NO_TRACKING),                         // missing tracking
    o('12:15', 'Shipped', 'Unpaid', JT, S2, PG2, 'ហេង សុខហេង', [[7, 1]]),
    o('12:30', 'Shipped', 'Unpaid', DRIVER, S3, PG3, 'ស្រី ណារី', [[0, 2]]),
    o('12:45', 'Shipped', 'Get File', VET, S1, PG1, 'បង សុវណ្ណ', [[8, 1]]),

    // ── Confirmed (14) — 3 Deposit, 11 Unpaid ──
    o('13:00', 'Confirmed', 'Unpaid', JT, S2, PG2, 'លោកគ្រូ ចាន់ថន', [[3, 1]]),
    o('13:10', 'Confirmed', 'Unpaid', JT, S3, PG3, 'នាង បូផា', [[6, 1]]),
    o('13:20', 'Confirmed', 'Deposit', JT, S1, PG1, 'ពូ សារឿន', [[9, 1]], { deposit: 20 }),
    o('13:30', 'Confirmed', 'Unpaid', DRIVER, S2, PG2, 'មីង សុភ័ក្ត្រ', [[2, 1]]),
    o('13:40', 'Confirmed', 'Unpaid', JT, S3, PG3, 'បង វុទ្ធី', [[0, 1], [7, 1]]),
    o('13:50', 'Confirmed', 'Unpaid', JT, S1, PG1, 'អ្នកស្រី ចាន់ណា', [[1, 1]]),
    o('14:00', 'Confirmed', 'Deposit', VET, S2, PG2, 'Dara Kim', [[4, 1]], { deposit: 25 }),
    o('14:10', 'Confirmed', 'Unpaid', JT, S3, PG3, 'Vannak Lim', [[8, 1]]),
    o('14:20', 'Confirmed', 'Unpaid', JT, S1, PG1, 'Kimheng Ly', [[3, 1]]),
    o('14:30', 'Confirmed', 'Unpaid', JT, S2, PG2, 'Sreypov Sok', [[6, 1], [2, 1]]),
    o('14:40', 'Confirmed', 'Unpaid', JT, S3, PG3, 'សុភា', [[9, 1]]),
    o('14:50', 'Confirmed', 'Deposit', JT, S1, PG1, 'បង ដារ៉ា', [[0, 2]], { deposit: 12 }),
    o('15:00', 'Confirmed', 'Unpaid', JT, S2, PG2, 'អ្នកមីង សុខា', [[7, 1]]),
    o('15:10', 'Confirmed', 'Unpaid', JT, S3, PG3, 'ចាន់ សុផល', [[1, 1], [2, 1]]),

    // ── Cancelled (3) — one Cancel-paid, two Unpaid ──
    o('15:20', 'Cancelled', 'Cancel', JT, S1, PG1, 'បងស្រី លីដា', [[5, 1]]),
    o('15:30', 'Cancelled', 'Unpaid', JT, S2, PG2, 'ពូ វណ្ណា', [[3, 1]]),
    o('15:40', 'Cancelled', 'Unpaid', DRIVER, S3, PG3, 'នាង ស្រីមុំ', [[2, 1]]),

    // ── Pending (2) — awaiting confirmation ──
    o('15:50', 'Pending', 'Unpaid', JT, S1, PG1, 'លោក ប៊ុនធឿន', [[6, 1]], { remark: 'Call to confirm size' }),
    o('15:55', 'Pending', 'Deposit', JT, S2, PG2, 'ម៉ាក់ ស្រីពៅ', [[9, 1]], { deposit: 10 }),

    // ── Drafted (2) — not yet placed ──
    o('16:00', 'Drafted', 'Unpaid', JT, S3, PG3, 'បង រតនា', [[0, 1], [1, 1]]),
    o('16:05', 'Drafted', 'Unpaid', JT, S1, PG1, 'អ៊ុំ ចន្ធី', [[8, 1]]),
];

export const fixtureOrders: Sale[] = SPECS.map((spec, i) => buildOrder(spec, 300 + i));
