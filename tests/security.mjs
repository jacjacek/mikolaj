import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// Audit-only adapter. No network, production storage, credentials, or source edits.
const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const results = [];
function fixture(mail = false) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const sql = { exec(query, ...args) {
    if (!args.length && query.trim().split(';').filter(x => x.trim()).length > 1) { db.exec(query); return { toArray: () => [] }; }
    const statement = db.prepare(query);
    return { toArray: () => statement.all(...args) };
  }};
  // Execute immediately, like Cloudflare's synchronous SQL API.
  const immediateSql = { exec(query, ...args) { const rows = sql.exec(query, ...args).toArray(); return { toArray: () => rows }; } };
  const ctx = { storage: { sql: immediateSql, transactionSync(fn) {
    db.exec('SAVEPOINT audit');
    try { const result = fn(); db.exec('RELEASE audit'); return result; }
    catch (e) { db.exec('ROLLBACK TO audit; RELEASE audit'); throw e; }
  }}};
  const sent = [], logs = [];
  let derivePause, deriveStarted;
  const crypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), randomUUID: webcrypto.randomUUID.bind(webcrypto), subtle: {
    importKey: webcrypto.subtle.importKey.bind(webcrypto.subtle),
    digest: webcrypto.subtle.digest.bind(webcrypto.subtle),
    async deriveBits(...args) { const hold = derivePause; if (hold) { derivePause = null; deriveStarted(); await hold; } return webcrypto.subtle.deriveBits(...args); },
  }};
  const context = vm.createContext({ crypto, TextEncoder, TextDecoder, Response, Request, URL, btoa,
    DurableObject: class {}, console: { error: (...args) => logs.push(args) },
    fetch: async (url, init) => { assert.equal(url, 'https://api.resend.com/emails'); sent.push(JSON.parse(init.body)); return Response.json({ id: 'synthetic' }); },
  });
  const imports = [...source.matchAll(/^import (\w+) from /gm)].map(m => `const ${m[1]}='';`).join('\n');
  vm.runInContext(imports + '\n' + source.replace(/^import .*;\n/gm, '').replace('export class FamilyStore', 'class FamilyStore').replace('export default {', 'globalThis.edge = {') + '\nglobalThis.Store=FamilyStore;', context);
  const store = new context.Store(ctx, mail ? { RESEND_API_KEY: 'audit-stub' } : {});
  let ip = 0;
  async function call(path, method = 'GET', body, cookie, extra = {}) {
    const headers = { 'CF-Connecting-IP': '192.0.2.' + (++ip % 250), ...extra };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await store.fetch(new Request('https://audit.example/api/' + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    return { status: res.status, body: await res.json(), cookie: res.headers.get('Set-Cookie')?.split(';')[0] };
  }
  async function register(name, email = name.toLowerCase() + '@example.test') {
    const r = await call('register', 'POST', { name, email, password: 'long-audit-password', familyName: name + ' family' });
    assert.equal(r.status, 200);
    const me = (await call('state', 'GET', undefined, r.cookie)).body.user;
    return { ...me, cookie: r.cookie };
  }
  async function join(admin, name) {
    const invite = (await call('admin', 'GET', undefined, admin.cookie)).body.invite.split('=')[1];
    const r = await call('join', 'POST', { name, email: name.toLowerCase() + '@example.test', password: 'long-audit-password', inviteToken: invite });
    assert.equal(r.status, 200);
    return { ...(await call('state', 'GET', undefined, r.cookie)).body.user, cookie: r.cookie };
  }
  async function addWish(user, title = 'Synthetic gift') {
    const r = await call('wishes', 'POST', { title, tier: 'ok' }, user.cookie);
    assert.equal(r.status, 201); return r.body.id;
  }
  function pauseKdf() {
    let release;
    derivePause = new Promise(r => { release = r; });
    const started = new Promise(r => { deriveStarted = r; });
    return { started, release };
  }
  return { db, store, call, register, join, addWish, sent, logs, pauseKdf, context };
}
async function check(name, fn) {
  try { const evidence = await fn(); results.push({ name, status: 'confirmed', evidence }); }
  catch (e) { results.push({ name, status: 'test-failed', error: e.stack }); process.exitCode = 1; }
}

await check('Cross-family isolation', async () => {
  const f = fixture(), a = await f.register('A'), b = await f.register('B'), w = await f.addWish(b);
  assert.equal((await f.call(`wishes/${w}/reserve`, 'POST', {}, a.cookie)).status, 404);
  assert.equal((await f.call(`members/${b.id}/link`, 'POST', {}, a.cookie)).status, 404);
});
await check('Own reservations never appear in organiser response', async () => {
  const f = fixture(), a = await f.register('A'), b = await f.join(a, 'B'), w = await f.addWish(a);
  const before = (await f.call('admin', 'GET', undefined, a.cookie)).body;
  await f.call(`wishes/${w}/reserve`, 'POST', {}, b.cookie);
  await f.call('session', 'PATCH', {adminMode:true}, a.cookie);
  const after = (await f.call('admin', 'GET', undefined, a.cookie)).body;
  assert.equal('hidden' in after, false); assert.equal(after.reservations.length,0);
});
await check('Organiser cannot obtain existing account reset token', async () => {
  const f = fixture(), a = await f.register('A'), b = await f.join(a, 'B');
  assert.equal((await f.call(`members/${b.id}/link`, 'POST', {}, a.cookie)).status,403);
});
await check('Short passwords rejected', async () => {
  const f=fixture();
  assert.equal((await f.call('register','POST',{name:'A',email:'a@example.test',password:'1234',familyName:'A'})).status,400);
});
await check('Invalid member mutation is atomic', async () => {
  const f=fixture(),a=await f.register('A'),b=await f.join(a,'B');
  assert.equal((await f.call(`members/${b.id}`,'PATCH',{canAdd:true,managedBy:a.id},a.cookie)).status,400);
  assert.equal(f.db.prepare('SELECT can_add FROM members WHERE id=?').get(b.id).can_add,0);
});
await check('Reassignment resets purchase', async () => {
  const f=fixture(),a=await f.register('A'),b=await f.join(a,'B'),c=await f.join(a,'C'),w=await f.addWish(b);
  await f.call(`wishes/${w}/reserve`,'POST',{},a.cookie);
  await f.call(`wishes/${w}/reserve`,'PATCH',{purchased:true},a.cookie);
  await f.call('session','PATCH',{adminMode:true},a.cookie);
  await f.call(`wishes/${w}/reserve`,'POST',{buyerId:c.id},a.cookie);
  assert.equal((await f.call('state','GET',undefined,c.cookie)).body.wishes[0].purchased,false);
});
await check('Recipient quota does not disclose existence', async () => {
  const f=fixture(true),a=await f.register('A');
  for(let i=0;i<4;i++) assert.equal((await f.call('forgot','POST',{email:a.email})).status,200);
});
await check('Unverified email receives no private digest', async () => {
  const f=fixture(true),a=await f.register('A'),b=await f.join(a,'B');
  await f.addWish(b); await f.store.digest(); assert.equal(f.sent.length,0);
});
await check('Concurrent link issuance leaves one token', async () => {
  const f=fixture(),a=await f.register('A'); await Promise.all([f.store.newLink(a),f.store.newLink(a)]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM links').get().n,1);
});
await check('Reset establishes session and invalidates old session', async () => {
  const f=fixture(),a=await f.register('A'),token=await f.store.newLink(a);
  const r=await f.call(`link/${token}`,'POST',{password:'replacement-password'});
  assert.equal(r.status,200);
  assert.equal((await f.call('state','GET',undefined,r.cookie)).body.user.id,a.id);
  assert.equal((await f.call('state','GET',undefined,a.cookie)).body.user,null);
});
await check('Oversized body rejected', async () => {
  const f=fixture(); assert.equal((await f.call('login','POST',{email:'a'.repeat(17000)})).status,413);
});
console.log(JSON.stringify(results,null,2));
