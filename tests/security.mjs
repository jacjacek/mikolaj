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
  assert.equal((await f.call('register','POST',{name:'A',email:'a@example.test',password:'123',familyName:'A'})).status,400);
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
await check('Digest still reaches existing account holders', async () => {
  const f=fixture(true),a=await f.register('A'),b=await f.join(a,'B');
  await f.addWish(b); await f.store.digest(); assert.deepEqual(f.sent.map(m=>m.to).flat(),[a.email]);
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
await check('One account in several families with separate roles', async () => {
  const f=fixture(), a=await f.register('A'), b=await f.register('B');
  const invite=(await f.call('admin','GET',undefined,b.cookie)).body.invite.split('=')[1];
  // A dołącza do rodziny B tym samym kontem, będąc zalogowanym
  const j=await f.call('families/join','POST',{inviteToken:invite},a.cookie);
  assert.equal(j.status,200);
  let s=(await f.call('state','GET',undefined,a.cookie)).body;
  assert.equal(s.family.name,'B family'); assert.equal(s.user.isAdmin,false); assert.equal(s.families.length,2);
  assert.equal((await f.call('admin','GET',undefined,a.cookie)).status,403);
  // przełączenie z powrotem: znów organizator
  const home=s.families.find(x=>x.name==='A family');
  assert.equal((await f.call('switch','POST',{memberId:home.memberId},a.cookie)).status,200);
  s=(await f.call('state','GET',undefined,a.cookie)).body;
  assert.equal(s.user.isAdmin,true); assert.equal(s.user.id,a.id);
  // nie da się przełączyć na cudze członkostwo
  assert.equal((await f.call('switch','POST',{memberId:b.id},a.cookie)).status,404);
  // drugi raz to samo zaproszenie nie tworzy duplikatu
  assert.equal((await f.call('families/join','POST',{inviteToken:invite},a.cookie)).body.already,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM members WHERE account_id=(SELECT account_id FROM members WHERE id=?)').get(a.id).n,2);
});
await check('Families of one account stay isolated', async () => {
  const f=fixture(), a=await f.register('A'), b=await f.register('B'), w=await f.addWish(b);
  const invite=(await f.call('admin','GET',undefined,b.cookie)).body.invite.split('=')[1];
  await f.call('families/join','POST',{inviteToken:invite},a.cookie);
  const s=(await f.call('state','GET',undefined,a.cookie)).body;
  await f.call('switch','POST',{memberId:s.families.find(x=>x.name==='A family').memberId},a.cookie);
  // w rodzinie A nie widać ani nie zmienia się niczego z rodziny B
  assert.equal((await f.call(`wishes/${w}/reserve`,'POST',{},a.cookie)).status,404);
  assert.equal((await f.call('state','GET',undefined,a.cookie)).body.wishes.some(x=>x.id===w),false);
  // tryb organizatora nie przechodzi do innej rodziny
  await f.call('session','PATCH',{adminMode:true},a.cookie);
  await f.call('switch','POST',{memberId:s.families.find(x=>x.name==='B family').memberId},a.cookie);
  assert.equal((await f.call('state','GET',undefined,a.cookie)).body.user.adminUntil,0);
});
await check('Join form attaches existing account only with its password', async () => {
  const f=fixture(), a=await f.register('A'), b=await f.register('B');
  const invite=(await f.call('admin','GET',undefined,b.cookie)).body.invite.split('=')[1];
  assert.equal((await f.call('join','POST',{name:'A',email:a.email,password:'wrong-password',inviteToken:invite})).status,409);
  const r=await f.call('join','POST',{name:'Ania',email:a.email,password:'long-audit-password',inviteToken:invite});
  assert.equal(r.status,200);
  const s=(await f.call('state','GET',undefined,r.cookie)).body;
  assert.equal(s.family.name,'B family'); assert.equal(s.user.name,'Ania'); assert.equal(s.families.length,2);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,2);
});
await check('Removal from one family keeps the account in others', async () => {
  const f=fixture(), a=await f.register('A'), b=await f.register('B');
  const invite=(await f.call('admin','GET',undefined,b.cookie)).body.invite.split('=')[1];
  await f.call('families/join','POST',{inviteToken:invite},a.cookie);
  const inB=(await f.call('state','GET',undefined,a.cookie)).body.user.id;
  assert.equal((await f.call(`members/${inB}`,'DELETE',undefined,b.cookie)).status,200);
  const s=(await f.call('state','GET',undefined,a.cookie)).body;
  assert.equal(s.user.id,a.id); assert.equal(s.families.length,1);
  assert.equal((await f.call('login','POST',{email:a.email,password:'long-audit-password'})).status,200);
  // usunięcie z ostatniej rodziny usuwa konto
  const c=await f.join(b,'C');
  await f.call(`members/${c.id}`,'DELETE',undefined,b.cookie);
  assert.equal((await f.call('login','POST',{email:c.email,password:'long-audit-password'})).status,401);
});
await check('Takeover link can attach list to an existing account', async () => {
  const f=fixture(), a=await f.register('A'), b=await f.register('B');
  const kid=(await f.call('members','POST',{name:'Kid'},b.cookie)).body.id;
  const url=(await f.call(`members/${kid}/link`,'POST',{},b.cookie)).body.url, token=url.split('=')[1];
  assert.equal((await f.call(`link/${token}`,'POST',{email:a.email,password:'wrong-password'})).status,409);
  const r=await f.call(`link/${token}`,'POST',{email:a.email,password:'long-audit-password'});
  assert.equal(r.status,200);
  const s=(await f.call('state','GET',undefined,r.cookie)).body;
  assert.equal(s.user.id,kid); assert.equal(s.families.length,2);
  // stare hasło konta działa dalej
  assert.equal((await f.call('login','POST',{email:a.email,password:'long-audit-password'})).status,200);
});
await check('Password reset ends sessions in every family', async () => {
  const f=fixture(), a=await f.register('A'), b=await f.register('B');
  const invite=(await f.call('admin','GET',undefined,b.cookie)).body.invite.split('=')[1];
  await f.call('families/join','POST',{inviteToken:invite},a.cookie); // sesja a wskazuje teraz rodzinę B
  const second=(await f.call('login','POST',{email:a.email,password:'long-audit-password'})).cookie;
  const token=await f.store.newLink(a);
  assert.equal((await f.call(`link/${token}`,'POST',{password:'replacement-password'})).status,200);
  assert.equal((await f.call('state','GET',undefined,a.cookie)).body.user,null);
  assert.equal((await f.call('state','GET',undefined,second)).body.user,null);
});
await check('Digest sends one mail per account across families', async () => {
  const f=fixture(true), a=await f.register('A'), b=await f.register('B'), c=await f.join(a,'C');
  const invite=(await f.call('admin','GET',undefined,b.cookie)).body.invite.split('=')[1];
  await f.call('families/join','POST',{inviteToken:invite},c.cookie);
  await f.addWish(a); await f.addWish(b);
  await f.store.digest();
  const toC=f.sent.filter(m=>m.to[0]===c.email);
  assert.equal(toC.length,1);
  assert.match(toC[0].text,/A family/); assert.match(toC[0].text,/B family/);
});
await check('Legacy members migrate to accounts', async () => {
  const f=fixture(), a=await f.register('A');
  // symulacja starej bazy: członek bez konta w tabeli accounts
  f.db.exec("DELETE FROM sessions; DELETE FROM accounts; UPDATE members SET account_id=NULL");
  const salt='s';
  const pw=await (async()=>{ const k=await webcrypto.subtle.importKey('raw',new TextEncoder().encode('legacy-pass'),'PBKDF2',false,['deriveBits']); return Buffer.from(await webcrypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},k,256)).toString('hex'); })();
  f.db.prepare("UPDATE members SET email='legacy@example.test',salt=?,password_hash=? WHERE id=?").run(salt,pw,a.id);
  const store2=new f.context.Store(f.store.ctx,{});
  const r=await store2.fetch(new Request('https://audit.example/api/login',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.9'},body:JSON.stringify({email:'legacy@example.test',password:'legacy-pass'})}));
  assert.equal(r.status,200);
  assert.equal(f.db.prepare('SELECT account_id FROM members WHERE id=?').get(a.id).account_id,a.id);
});
await check('Leaving a family', async () => {
  const f=fixture(), a=await f.register('A'), b=await f.register('B'), c=await f.join(b,'C');
  // jedyna rodzina — nie można
  assert.equal((await f.call('leave','POST',{},c.cookie)).status,409);
  const invite=(await f.call('admin','GET',undefined,b.cookie)).body.invite.split('=')[1];
  await f.call('families/join','POST',{inviteToken:invite},a.cookie);
  const inB=(await f.call('state','GET',undefined,a.cookie)).body.user.id;
  // A w rodzinie B prowadzi dziecko i rezerwuje prezent C
  f.db.prepare('UPDATE members SET can_add=1 WHERE id=?').run(inB);
  const kidId=(await f.call('members','POST',{name:'Kid'},a.cookie)).body.id;
  const w=await f.addWish(c); await f.call(`wishes/${w}/reserve`,'POST',{},a.cookie);
  const r=await f.call('leave','POST',{},a.cookie);
  assert.equal(r.status,200); assert.equal(r.body.family,'A family');
  const s=(await f.call('state','GET',undefined,a.cookie)).body;
  assert.equal(s.user.id,a.id); assert.equal(s.families.length,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM members WHERE id=?').get(inB).n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE wish_id=?').get(w).n,0);
  assert.equal(f.db.prepare('SELECT managed_by FROM members WHERE id=?').get(kidId).managed_by,b.id);
  // organizator nie opuszcza, dopóki nie przekaże roli
  const inv2=(await f.call('admin','GET',undefined,a.cookie)).body.invite.split('=')[1];
  await f.call('families/join','POST',{inviteToken:inv2},b.cookie);
  await f.call('switch','POST',{memberId:b.id},b.cookie);
  assert.equal((await f.call('leave','POST',{},b.cookie)).status,409);
});
console.log(JSON.stringify(results,null,2));
