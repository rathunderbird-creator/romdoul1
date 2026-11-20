// Unit test of src/utils/rejectionReasons.ts: the Sales Setup › Rejection
// Reasons list rules (defaults until a store saves its own list, the first
// edit saves the whole list, duplicate / missing names are no-ops) and the
// options a reason picker shows. Transpiled on the fly with the repo's
// esbuild; see tests/README.md.
import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync, rmSync } from 'fs';
import { build } from 'esbuild';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = await build({
    stdin: { contents: `export * from './src/utils/rejectionReasons.ts'; export * from './src/utils/configOps.ts';`, resolveDir: repo, loader: 'ts' },
    bundle: true, format: 'esm', write: false,
});
const bundlePath = path.join(repo, 'tests', '.rejection-reasons.bundle.mjs');
writeFileSync(bundlePath, out.outputFiles[0].text);
const m = await import('file:///' + bundlePath.replace(/\\/g, '/'));
rmSync(bundlePath);

let pass = 0, fail = 0;
const check = (l, c, extra) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', l, c || extra === undefined ? '' : JSON.stringify(extra)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const D = m.DEFAULT_REJECTION_REASONS;
// What the saved key holds after the op (the same apply the store and SQL use).
const after = (saved, op) => m.applyConfigOpsLocally(saved === undefined ? {} : { rejectionReasons: saved }, { rejectionReasons: op }).rejectionReasons;

check('no saved list → the defaults', eq(m.rejectionReasonList(undefined), D) && D.length >= 5);
check('a saved list wins, even empty', eq(m.rejectionReasonList(['A']), ['A']) && eq(m.rejectionReasonList([]), []));
check('junk entries are dropped', eq(m.rejectionReasonList(['A', '', '  ', 3, null]), ['A']));

const firstAdd = m.rejectionReasonOp(undefined, 'add', '  Too expensive ');
check('first add saves the whole list (defaults kept)', firstAdd?.op === 'set' && eq(after(undefined, firstAdd), [...D, 'Too expensive']), firstAdd);
const firstRemove = m.rejectionReasonOp(undefined, 'remove', 'wrong ADDRESS');
check('first remove saves the defaults minus that one', firstRemove?.op === 'set' && eq(after(undefined, firstRemove), D.filter(r => r !== 'Wrong address')), firstRemove);
check('add on a saved list appends', eq(after(['A'], m.rejectionReasonOp(['A'], 'add', 'B')), ['A', 'B']));
check('remove on a saved list removes every spelling', eq(after(['A', 'a ', 'B'], m.rejectionReasonOp(['A', 'a ', 'B'], 'remove', 'A')), ['B']));
check('duplicate add (any case) is a no-op', m.rejectionReasonOp(['Wrong address'], 'add', 'wrong address') === null && m.rejectionReasonOp(undefined, 'add', 'Changed mind') === null);
check('empty name is a no-op', m.rejectionReasonOp(['A'], 'add', '   ') === null && m.rejectionReasonOp(['A'], 'remove', '') === null);
check('removing an unlisted name is a no-op', m.rejectionReasonOp(['A'], 'remove', 'Z') === null);
check('every op passes the config-op validator', (() => { try { for (const op of [firstAdd, firstRemove, m.rejectionReasonOp(['A'], 'add', 'B')]) m.assertValidConfigOps({ rejectionReasons: op }); return true; } catch { return false; } })());

check('reason statuses', m.reasonApplies('Returned') && m.reasonApplies('Cancelled') && m.reasonApplies('ReStock') && !m.reasonApplies('Delivered') && !m.reasonApplies(undefined));
check('options: listed current reason is not repeated', eq(m.reasonOptions(['A', 'B'], 'a'), ['A', 'B']));
check('options: an unlisted (Other / removed) reason is kept', eq(m.reasonOptions(['A'], 'Customer abroad'), ['A', 'Customer abroad']));
check('options: no reason → just the list', eq(m.reasonOptions(['A'], null), ['A']) && eq(m.reasonOptions(['A'], '  '), ['A']));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
