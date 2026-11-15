// PGlite test of migrations/fix_journal_entry_numbers.sql on the real stack
// (tests/fifo-test-db.mjs: full_schema.sql, guards, FIFO, the four packs).
// Checks:
//   * the one-time pass: a group sharing <TYPE>-<yyyymmdd>-<nnn> keeps the
//     oldest and renumbers the rest (their descriptions too), other entries
//     and NULL numbers untouched, a re-run changes nothing;
//   * new entries: a free number is kept as sent; a number whose ref is in
//     use (a count-based guess after a deletion, two saves of the same
//     guess) gets the next free one of its type and day, in the
//     description too; numbers never come back after a deletion; a new
//     day starts at 001; NULL and non-standard numbers are left alone;
//   * a restore (rows put back with their own numbers into an emptied
//     table) keeps every number and description, and later entries go on
//     after them;
//   * the packs' own booking (wp_internal.wp_post_entry) and an insert as
//     anon go through it, and anon cannot touch the counters.
// See tests/README.md for how to run it.
import { makeDb, harness, mig, strip } from './fifo-test-db.mjs';

const db = await makeDb();
const { q, one, check, errOf, done } = harness(db);

const ins = async (num, desc, at, status = 'Draft') => (await one(
    `INSERT INTO journal_entries (date, description, reference_id, status, entry_number, created_at)
     VALUES ('2026-11-15', $2, 'T-' || gen_random_uuid(), $4, $1, $3::timestamptz) RETURNING id, entry_number, description`,
    [num, desc, at, status]));
const row = async id => one(`SELECT entry_number, description FROM journal_entries WHERE id = $1`, [id]);
const dupCount = async () => (await one(`SELECT count(*)::int AS n FROM (SELECT regexp_replace(entry_number, '^JE-\\d+-', '') t
    FROM journal_entries WHERE entry_number IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x`)).n;

// Before the fix: entries as the count-based numbering left them.
const a1 = await ins('JE-1-RCP-20261115-001', 'Retail - RCP-20261115-001 — A', '2026-11-15T01:00:00Z');
const a2 = await ins('JE-2-RCP-20261115-002', 'Retail - RCP-20261115-002 — B', '2026-11-15T01:00:01Z');
const d1 = await ins('JE-2-RCP-20261115-002', 'Retail - RCP-20261115-002 — C', '2026-11-15T01:00:02Z'); // bulk race
const d2 = await ins('JE-2-RCP-20261115-002', 'Retail - RCP-20261115-002 — D', '2026-11-15T01:00:03Z');
const m1 = await ins('JE-5-MAN-20261115-001', 'Manual fix', '2026-11-15T02:00:00Z');
const n1 = await ins(null, 'Old entry without a number', '2026-01-01T00:00:00Z');
const w1 = await ins('JE-9-WSP-20261114-004', 'Wholesale - WSP-20261114-004 — E', '2026-11-14T02:00:00Z');

await db.exec(strip(mig('fix_journal_entry_numbers.sql')));

check('oldest of the group keeps its number', (await row(a2.id)).entry_number === 'JE-2-RCP-20261115-002');
const r1 = await row(d1.id), r2 = await row(d2.id);
// 7 entries, highest global 9: the renumbered ones go on from 10.
check('duplicate 1 renumbered: next global, next RCP of that day', r1.entry_number === 'JE-10-RCP-20261115-003', r1);
check('duplicate 1 description follows', r1.description === 'Retail - RCP-20261115-003 — C', r1);
check('duplicate 2 renumbered after it', r2.entry_number === 'JE-11-RCP-20261115-004' && r2.description === 'Retail - RCP-20261115-004 — D', r2);
check('other entries untouched',
    (await row(a1.id)).entry_number === 'JE-1-RCP-20261115-001' && (await row(m1.id)).entry_number === 'JE-5-MAN-20261115-001'
    && (await row(w1.id)).entry_number === 'JE-9-WSP-20261114-004' && (await row(n1.id)).entry_number === null);
check('no shared numbers left', await dupCount() === 0);

const snapshot = async () => JSON.stringify((await q(`SELECT id, entry_number, description FROM journal_entries ORDER BY id`)).rows);
const before = await snapshot();
await db.exec(strip(mig('fix_journal_entry_numbers.sql')));
check('re-run changes nothing', (await snapshot()) === before);

// New entries.
const e1 = await ins('JE-12-RCP-20261115-005', 'Retail - RCP-20261115-005 — F', '2026-11-15T03:00:00Z');
check('a free number is kept as sent', e1.entry_number === 'JE-12-RCP-20261115-005' && e1.description === 'Retail - RCP-20261115-005 — F', e1);
// A deletion lowers the count: the count-based guess is a ref in use.
await q(`DELETE FROM journal_entries WHERE id = $1`, [a1.id]);
const e2 = await ins('JE-7-RCP-20261115-005', 'Retail - RCP-20261115-005 — G', '2026-11-15T03:01:00Z');
check('a ref in use gets the next free one, description too', e2.entry_number === 'JE-13-RCP-20261115-006'
    && e2.description === 'Retail - RCP-20261115-006 — G', e2);
// Two saves with the same guess (a bulk settle).
const e3 = await ins('JE-14-RCP-20261115-007', 'Retail - RCP-20261115-007 — H', '2026-11-15T03:02:00Z');
const e4 = await ins('JE-14-RCP-20261115-007', 'Retail - RCP-20261115-007 — I', '2026-11-15T03:02:00Z');
check('same guess twice: first kept, second renumbered', e3.entry_number === 'JE-14-RCP-20261115-007'
    && e4.entry_number === 'JE-15-RCP-20261115-008' && e4.description === 'Retail - RCP-20261115-008 — I', [e3, e4]);
// The deleted entry's number is free in the table, but the counter is past it.
const e5 = await ins('JE-7-RCP-20261115-008', 'Retail - RCP-20261115-008 — J', '2026-11-15T03:03:00Z');
check('a number in use is never handed out again', e5.entry_number === 'JE-16-RCP-20261115-009', e5);
const e6 = await ins('JE-17-RCP-20261116-001', 'Retail - RCP-20261116-001 — K', '2026-11-16T01:00:00Z');
check('a new day starts at 001', e6.entry_number === 'JE-17-RCP-20261116-001', e6);
const e7 = await ins('JE-3-MAN-20261115-001', 'Manual', '2026-11-15T03:04:00Z');
check('another type keeps its own day counter', e7.entry_number === 'JE-18-MAN-20261115-002', e7);
const e8 = await ins(null, 'No number', '2026-11-15T03:05:00Z');
const e9 = await ins('custom-1', 'Custom', '2026-11-15T03:06:00Z');
check('NULL and non-standard numbers left alone', e8.entry_number === null && e9.entry_number === 'custom-1');

// The packs' booking path (count-based guess; the ref may be in use).
const acct = async code => (await one(`SELECT id FROM chart_of_accounts WHERE account_code = $1`, [code])).id;
const wp = (await one(`SELECT wp_internal.wp_post_entry('WSP', '2026-11-14', 'Shop', 'WO-1', 10, $1, 'Dr', $2, 'Cr') AS id`,
    [await acct('1200'), await acct('4000')])).id;
const wr = await row(wp);
// Its count-based guess (1 WSP entry that day + 1 = 002) is free: kept, even below 004.
check('pack booking: its free guess is kept', /^JE-\d+-WSP-20261114-002$/.test(wr.entry_number)
    && wr.description === 'Wholesale - WSP-20261114-002 — Shop', wr);
check('still no shared numbers', await dupCount() === 0);

// As anon (the app's role), with a ref already in use.
await q(`SET ROLE anon`);
const an = await one(`INSERT INTO journal_entries (date, description, reference_id, status, entry_number)
    VALUES ('2026-11-15', 'Retail - RCP-20261115-002 — Anon', 'T-anon', 'Draft', 'JE-2-RCP-20261115-002') RETURNING entry_number, description`);
check('insert as anon is renumbered', /^JE-\d+-RCP-20261115-010$/.test(an.entry_number) && an.description === 'Retail - RCP-20261115-010 — Anon', an);
const err = await errOf(`UPDATE journal_entry_number_counters SET last_value = 0`);
check('anon cannot touch the counters', /permission denied/i.test(err), err);
await q(`RESET ROLE`);

// A restore: the table emptied, every row put back with its own number
// (in another order), the counters table left as it was.
const saved = (await q(`SELECT * FROM journal_entries ORDER BY id DESC`)).rows;
await q(`DELETE FROM journal_entry_lines`);
await q(`DELETE FROM journal_entries`);
for (const r of saved) {
    await q(`INSERT INTO journal_entries (id, date, description, reference_id, status, entry_number, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [r.id, r.date, r.description, r.reference_id, r.status, r.entry_number, r.created_at]);
}
const after = JSON.stringify((await q(`SELECT id, entry_number, description FROM journal_entries ORDER BY id`)).rows);
check('restore keeps every number and description', after === JSON.stringify(saved.map(r => ({ id: r.id, entry_number: r.entry_number, description: r.description })).sort((x, y) => (x.id < y.id ? -1 : 1))));
const e10 = await ins('JE-1-RCP-20261115-002', 'Retail - RCP-20261115-002 — L', '2026-11-16T05:00:00Z');
check('after a restore, a stale guess goes on after the restored numbers', /^JE-\d+-RCP-20261115-011$/.test(e10.entry_number), e10);
// Restoring into a store whose counters were cleared too.
await q(`DELETE FROM journal_entries`);
await q(`DELETE FROM journal_entry_number_counters`);
for (const r of saved) {
    await q(`INSERT INTO journal_entries (id, date, description, reference_id, status, entry_number, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [r.id, r.date, r.description, r.reference_id, r.status, r.entry_number, r.created_at]);
}
check('restore with empty counters keeps every number too',
    JSON.stringify((await q(`SELECT id, entry_number, description FROM journal_entries ORDER BY id`)).rows) === after);
const e11 = await ins('JE-1-RCP-20261115-002', 'Retail - RCP-20261115-002 — M', '2026-11-16T05:01:00Z');
const maxG = Math.max(...saved.filter(r => r.entry_number?.startsWith('JE-')).map(r => Number(r.entry_number.split('-')[1])));
check('and new entries go on after them', e11.entry_number === `JE-${maxG + 1}-RCP-20261115-011`, { e11, maxG });

done();
