// PGlite test of Warehouses › Move Stock (migrations/add_stock_transfers.sql)
// on the real stack in deploy order (tests/fifo-test-db.mjs, session guards
// included) and the live column types:
//   * the file is re-runnable;
//   * a warehouse-to-warehouse move takes from the source row and adds to
//     the destination (creating its row), records a transfer + lines, and
//     leaves products.stock, the FIFO pool and stock_movements alone;
//   * moving from Unassigned (NULL) is limited to products.stock minus what
//     warehouse_stock already tracks;
//   * every refusal (short stock, same warehouse, bad quantity, duplicate
//     product, unknown warehouse, no lines) changes nothing at all.
// See tests/README.md for how to run it.
import { makeDb, harness, mig, strip } from './fifo-test-db.mjs';

const db = await makeDb();
const { q, one, num, check, errOf, seedLayers, checkBalanced, done } = harness(db);

await db.exec(strip(mig('add_stock_transfers.sql')));
await db.exec(strip(mig('add_stock_transfers.sql')));
check('add_stock_transfers.sql runs twice', true);

const A = (await one(`INSERT INTO warehouses (name) VALUES ('Main') RETURNING id`)).id;
const B = (await one(`INSERT INTO warehouses (name) VALUES ('Branch') RETURNING id`)).id;
await q(`INSERT INTO products (id, name, price, stock) VALUES ('p1', 'Speaker', 10, 0), ('p2', 'Cable', 2, 0)`);
await seedLayers('p1', 20, 5, '2026-01-02');
await seedLayers('p2', 8, 1, '2026-01-02');
// p1: 12 tracked in A (8 unassigned); p2: none tracked (all 8 unassigned).
await q(`INSERT INTO warehouse_stock (warehouse_id, product_id, quantity) VALUES ($1, 'p1', 12)`, [A]);

const ws = async (wh, p) => {
    const r = await one(`SELECT quantity FROM warehouse_stock WHERE warehouse_id::TEXT = $1 AND product_id = $2`, [wh, p]);
    return r ? num(r.quantity) : null;
};
const snapshot = async () => JSON.stringify({
    ws: (await q(`SELECT warehouse_id::TEXT AS w, product_id, quantity FROM warehouse_stock ORDER BY 1, 2`)).rows,
    st: num((await one(`SELECT count(*) AS n FROM stock_transfers`)).n),
    stock: (await q(`SELECT id, stock FROM products ORDER BY id`)).rows,
});
const move = (from, to, lines, note = null) =>
    q(`SELECT transfer_warehouse_stock($1, $2, $3::jsonb, '2026-11-20', $4, 'u1') AS r`, [from, to, JSON.stringify(lines), note]);
const moveErr = (from, to, lines) =>
    errOf(`SELECT transfer_warehouse_stock($1, $2, $3::jsonb, '2026-11-20', NULL, 'u1')`, [from, to, JSON.stringify(lines)]);

const movementsBefore = num((await one(`SELECT count(*) AS n FROM stock_movements`)).n);

// 1. Warehouse to warehouse.
const r1 = (await move(A, B, [{ product_id: 'p1', quantity: 5 }], 'restock branch')).rows[0].r;
check('A -> B: source down by 5', (await ws(A, 'p1')) === 7);
check('A -> B: destination row created with 5', (await ws(B, 'p1')) === 5);
check('A -> B: returns transfer id and line count', !!r1.transfer_id && r1.lines === 1, r1);
const hdr = await one(`SELECT * FROM stock_transfers WHERE id = $1`, [r1.transfer_id]);
check('A -> B: header stored', hdr.from_warehouse_id === A && hdr.to_warehouse_id === B && hdr.note === 'restock branch' && hdr.created_by === 'u1', hdr);
const ln = (await q(`SELECT product_id, product_name, quantity FROM stock_transfer_lines WHERE transfer_id = $1`, [r1.transfer_id])).rows;
check('A -> B: one line with the product name', ln.length === 1 && ln[0].product_name === 'Speaker' && num(ln[0].quantity) === 5, ln);

// Second move adds to the existing destination row.
await move(A, B, [{ product_id: 'p1', quantity: 2 }]);
check('A -> B again: destination row added to (7)', (await ws(B, 'p1')) === 7 && (await ws(A, 'p1')) === 5);

// 2. From Unassigned: p1 has 20 - (5 + 7) = 8 unassigned, p2 has 8.
await move(null, A, [{ product_id: 'p1', quantity: 8 }, { product_id: 'p2', quantity: 3 }]);
check('Unassigned -> A: p1 tracked in A goes to 13', (await ws(A, 'p1')) === 13);
check('Unassigned -> A: p2 row created with 3', (await ws(A, 'p2')) === 3);
check('Unassigned -> A: header from is NULL',
    num((await one(`SELECT count(*) AS n FROM stock_transfers WHERE from_warehouse_id IS NULL`)).n) === 1);

// Company totals and costing untouched.
check('products.stock unchanged', JSON.stringify((await q(`SELECT id, stock FROM products ORDER BY id`)).rows.map(r => num(r.stock))) === '[20,8]');
check('no stock_movements written', num((await one(`SELECT count(*) AS n FROM stock_movements`)).n) === movementsBefore);
await checkBalanced('after moves');

// 3. Refusals change nothing.
const before = await snapshot();
const e1 = await moveErr(null, B, [{ product_id: 'p1', quantity: 1 }]);
check('Unassigned short (p1 has 0 left) is refused', /Not enough stock to move/.test(e1) && /only 0 unassigned/.test(e1), e1);
const e2 = await moveErr(B, A, [{ product_id: 'p1', quantity: 8 }]);
check('warehouse short is refused, naming the product', /Speaker: moving 8, only 7 in that warehouse/.test(e2), e2);
const e3 = await moveErr(B, A, [{ product_id: 'p2', quantity: 1 }]);
check('product with no row in the source counts as 0', /Cable: moving 1, only 0/.test(e3), e3);
const e4 = await moveErr(A, A, [{ product_id: 'p1', quantity: 1 }]);
check('same warehouse is refused', /must be different/.test(e4), e4);
const e5 = await moveErr(A, B, [{ product_id: 'p1', quantity: 1.5 }]);
check('fractional quantity is refused', /whole numbers/.test(e5), e5);
const e6 = await moveErr(A, B, [{ product_id: 'p1', quantity: 0 }]);
check('zero quantity is refused', /whole numbers/.test(e6), e6);
const e7 = await moveErr(A, B, [{ product_id: 'p1', quantity: 1 }, { product_id: 'p1', quantity: 1 }]);
check('duplicate product is refused', /more than one line/.test(e7), e7);
const e8 = await moveErr(A, '00000000-0000-0000-0000-000000000000', [{ product_id: 'p1', quantity: 1 }]);
check('unknown destination is refused', /destination warehouse no longer exists/.test(e8), e8);
const e9 = await moveErr(A, B, []);
check('no lines is refused', /at least one product/.test(e9), e9);
const e10 = await moveErr(A, B, [{ product_id: 'nope', quantity: 1 }]);
check('unknown product is refused', /no longer exists/.test(e10), e10);
// A two-line move where only the second is short: the first must not move.
const e11 = await moveErr(A, B, [{ product_id: 'p1', quantity: 1 }, { product_id: 'p2', quantity: 99 }]);
check('one short line refuses the whole move', /Cable/.test(e11), e11);
check('refusals changed nothing', (await snapshot()) === before);

// 4. Guarded signature: a NULL session passes while enforcement is off.
check('callable through the guarded signature with p_session NULL',
    !(await errOf(`SELECT transfer_warehouse_stock($1, $2, '[{"product_id":"p1","quantity":1}]'::jsonb, NULL, NULL, NULL, NULL)`, [A, B])));

done();
