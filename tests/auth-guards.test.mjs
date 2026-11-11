// PGlite test of migrations/add_auth_guards.sql (SEC-2): PIN matching parity
// with check_pin, token mint/verify/revoke/rotation, and column privileges.
// See tests/README.md for how to run it.
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const { PGlite } = await import(process.env.PGLITE_DIST || '@electric-sql/pglite');

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MIG = path.join(repo, 'migrations', 'add_auth_guards.sql');
const PIN_MIG = path.join(repo, 'migrations', 'applied', 'secure_pin_check.sql');
const db = new PGlite();
const q = (s, p) => db.query(s, p);
let pass = 0, fail = 0;
const check = (label, cond, extra) => {
    if (cond) { pass++; console.log('PASS', label); }
    else { fail++; console.log('FAIL', label, extra === undefined ? '' : JSON.stringify(extra)); }
};

// users table as in migrations/full_schema.sql (columns the functions touch).
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE TABLE users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, role_id TEXT, pin TEXT,
    base_salary NUMERIC DEFAULT 0, daily_target NUMERIC DEFAULT 0,
    weekly_target NUMERIC DEFAULT 0, monthly_target NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now());
INSERT INTO users (id, name, email, role_id, pin) VALUES
 ('u1','Admin','a@x.com','admin',' 1234 '),
 ('u2','Sok','s@x.com','salesman','5678'),
 ('u3','NoPin','n@x.com','cashier','');
`);

const strip = f => fs.readFileSync(f, 'utf8').replace(/NOTIFY[^;]*;/g, '');
await db.exec(strip(PIN_MIG)); // prerequisite, as the migration header orders it
await db.exec(strip(MIG));
await db.exec(strip(MIG)); // safe to re-run
check('migration runs twice', true);

const login = async (pin, id) => (await q(`SELECT * FROM login_with_pin($1,$2)`, [pin, id])).rows;
const verify = async (id, tok) => (await q(`SELECT verify_session($1,$2) AS ok`, [id, tok])).rows[0].ok;
const revoke = (id, tok) => q(`SELECT revoke_session($1,$2)`, [id, tok]);

// Wrong PIN / wrong id / empty pin account / null id
check('wrong pin -> no row', (await login('0000', 'u1')).length === 0);
check('null user id -> no row', (await login('1234', null)).length === 0);
check('empty-pin account never matches', (await login('', 'u3')).length === 0 && (await login('   ', 'u3')).length === 0);

// Successful login mints a token; trimmed-pin matching like check_pin
const [row1] = await login('1234', 'u1');
check('login u1 returns row', !!row1 && row1.role_id === 'admin' && row1.name === 'Admin');
check('token is 64 hex chars', /^[0-9a-f]{64}$/.test(row1.session_token));
check('no pin column in result', !('pin' in (row1 || {})));

// Token verifies; garbage doesn't
check('verify ok', await verify('u1', row1.session_token) === true);
check('verify trims token', await verify('u1', '  ' + row1.session_token + '  ') === true);
check('verify wrong token false', await verify('u1', 'deadbeef') === false);
check('verify empty token false', await verify('u1', '') === false);
check('verify null token false', await verify('u1', null) === false);
check('verify other user false', await verify('u2', row1.session_token) === false);
check('verify unknown user false', await verify('ghost', row1.session_token) === false);

// Only the hash is stored
const { rows: [u1row] } = await q(`SELECT session_tokens FROM users WHERE id='u1'`);
check('stored value is md5, not the token', u1row.session_tokens.length === 1 && u1row.session_tokens[0] !== row1.session_token && /^[0-9a-f]{32}$/.test(u1row.session_tokens[0]));

// Second login (another terminal) does NOT invalidate the first
const [row2] = await login('1234', 'u1');
check('second login mints a different token', row2.session_token !== row1.session_token);
check('first terminal still valid', await verify('u1', row1.session_token) === true);
check('second terminal valid', await verify('u1', row2.session_token) === true);

// Logout: revoke_session kills exactly that terminal's token
const [rowR] = await login('1234', 'u1');
await revoke('u1', rowR.session_token);
check('revoked token invalid', await verify('u1', rowR.session_token) === false);
check('other terminals survive a revoke', await verify('u1', row1.session_token) === true && await verify('u1', row2.session_token) === true);
await revoke('u1', 'not-a-real-token'); // quiet no-op
await revoke('u1', null);
await revoke('ghost', rowR.session_token);
check('revoking garbage is a quiet no-op', await verify('u1', row1.session_token) === true);

// Rotation: 8 kept, oldest falls out
const tokens = [row1.session_token, row2.session_token];
for (let i = 0; i < 8; i++) tokens.push((await login('1234', 'u1'))[0].session_token);
check('oldest token rotated out after 10 logins', await verify('u1', tokens[0]) === false && await verify('u1', tokens[1]) === false);
check('newest 8 still valid', (await Promise.all(tokens.slice(2).map(t => verify('u1', t)))).every(v => v === true));
const { rows: [u1b] } = await q(`SELECT array_length(session_tokens,1) AS n FROM users WHERE id='u1'`);
check('at most 8 hashes stored', u1b.n === 8);

// Privileges: anon can execute the fns, cannot read pin/session_tokens,
// cannot UPDATE or INSERT session_tokens (but can use the app's columns).
const can = async (sql) => { try { await db.exec(sql); return true; } catch { return false; } };
await db.exec(`SET ROLE anon`);
check('anon: login_with_pin executable', (await login('5678', 'u2')).length === 1);
check('anon: verify_session executable', typeof await verify('u2', 'x') === 'boolean');
check('anon: revoke_session executable', await can(`SELECT revoke_session('u2','x')`));
check('anon: cannot select pin', !(await can(`SELECT pin FROM users`)));
check('anon: cannot select session_tokens', !(await can(`SELECT session_tokens FROM users`)));
check('anon: can select allowed columns', await can(`SELECT id, name, email, role_id, created_at, base_salary FROM users`));
check('anon: cannot plant a token by UPDATE', !(await can(`UPDATE users SET session_tokens='{deadbeef}' WHERE id='u1'`)));
check('anon: cannot plant a token by INSERT', !(await can(`INSERT INTO users (id, name, role_id, pin, session_tokens) VALUES ('evil','Evil','admin','1','{deadbeef}')`)));
check('anon: can insert the app columns', await can(`INSERT INTO users (id, name, email, role_id, pin, base_salary, daily_target, weekly_target, monthly_target) VALUES ('u4','New','n4@x.com','cashier','4444',0,0,0,0)`));
check('anon: can update app columns', await can(`UPDATE users SET name='Sok2', role_id='cashier', pin='9999', base_salary=1, daily_target=1, weekly_target=1, monthly_target=1, email='s2@x.com' WHERE id='u2'`));
await db.exec(`RESET ROLE`);

// After the anon pin change, login works with the new pin only
check('old pin dead after change', (await login('5678', 'u2')).length === 0);
check('new pin works', (await login('9999', 'u2')).length === 1);
// The freshly inserted user can log in (INSERT column grant kept the flow)
check('inserted user can log in', (await login('4444', 'u4')).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
