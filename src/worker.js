import { DurableObject } from 'cloudflare:workers';
import html from '../public/index.html';
import css from '../public/app.css';
import app from '../public/app.js';
import favicon from '../public/favicon.svg';

const encoder = new TextEncoder();
const SESSION_AGE = 60 * 60 * 24 * 30;
const COOKIE = '__Host-mikolaj';
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
};
class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new AppError(status, message); };
const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { ...SECURITY, 'Cache-Control': 'no-store', ...headers } });
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join('');
const constantEqual = (a, b) => { let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; };
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits), n => n.toString(16).padStart(2, '0')).join('');
}
function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `Sprawdź pole „${label}” (maks. ${max} znaków).`);
  return value.trim();
}
function account(body) {
  const name = text(body.name, 'Imię', 60, true);
  const email = text(body.email, 'E-mail', 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Podaj poprawny adres e-mail.');
  if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 256) fail(400, 'Hasło musi mieć od 10 do 256 znaków.');
  return { name, email, password: body.password };
}
function wishFields(body) {
  const title = text(body.title, 'Nazwa prezentu', 160, true);
  const note = text(body.note ?? '', 'Wskazówki', 1500);
  let url = text(body.url ?? '', 'Link', 2000);
  if (url) {
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); url = parsed.href; }
    catch { fail(400, 'Link musi zaczynać się od https:// lub http:// i nie zawierać danych logowania.'); }
  }
  let price = body.price;
  if (price === '' || price === undefined) price = null;
  if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1000000)) fail(400, 'Podaj cenę od 0 do 1 000 000 zł lub zostaw puste pole.');
  if (price !== null) price = Math.round(price * 100) / 100;
  return { title, note, url, price };
}
const cookie = token => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_AGE}`;
const emptyCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
const publicWish = w => ({ id: w.id, ownerId: w.owner_id, title: w.title, note: w.note, url: w.url, price: w.price, createdAt: w.created_at });
const changedSince = (original, w) => ['title', 'note', 'url', 'price'].some(field => original[field] !== w[field]);

export class FamilyStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS family (id TEXT PRIMARY KEY, name TEXT NOT NULL, invite TEXT NOT NULL, invite_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES family(id), name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, letter TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS wishes (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', price REAL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations (wish_id TEXT PRIMARY KEY REFERENCES wishes(id) ON DELETE CASCADE, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, purchased INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS wishes_owner ON wishes(owner_id);
      CREATE INDEX IF NOT EXISTS reservations_member ON reservations(member_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    `);
    if (!this.rows('PRAGMA table_info(reservations)').some(column => column.name === 'snapshot')) {
      this.sql.exec("ALTER TABLE reservations ADD COLUMN snapshot TEXT NOT NULL DEFAULT '{}'");
    }
    this.sql.exec("UPDATE reservations SET snapshot=(SELECT json_object('title',title,'note',note,'url',url,'price',price) FROM wishes WHERE wishes.id=reservations.wish_id) WHERE snapshot='{}'");
  }
  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  one(query, ...args) { return this.rows(query, ...args)[0]; }
  rateLimit(key, max, seconds) {
    const now = Math.floor(Date.now() / 1000);
    this.sql.exec('DELETE FROM limits WHERE expires < ?', now);
    this.sql.exec('INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, now + seconds);
    if (this.one('SELECT count FROM limits WHERE key=?', key).count > max) fail(429, 'Za dużo prób. Spróbuj ponownie za kilkanaście minut.');
  }
  me(member) {
    const family = this.one('SELECT id,name FROM family WHERE id=?', member.family_id);
    const members = this.rows('SELECT m.id,m.name,m.letter,COUNT(w.id) AS wishCount FROM members m LEFT JOIN wishes w ON w.owner_id=m.id WHERE m.family_id=? GROUP BY m.id ORDER BY m.name COLLATE NOCASE', member.family_id);
    return { user: { id: member.id, name: member.name, email: member.email, isAdmin: Boolean(member.is_admin) }, family, members };
  }
  async session(member) {
    const token = random(); const hash = await digest(token);
    const now = Math.floor(Date.now() / 1000);
    this.sql.exec('DELETE FROM sessions WHERE expires < ?', now);
    this.sql.exec('INSERT INTO sessions VALUES(?,?,?)', hash, member.id, now + SESSION_AGE);
    return json(this.me(member), 200, { 'Set-Cookie': cookie(token) });
  }
  async fetch(request) {
    try { return await this.route(request); }
    catch (error) {
      if (error instanceof AppError) return json({ error: error.message }, error.status);
      // Never log payloads, wish content, invitations, passwords or cookies.
      console.error('Mikolaj request failed', error.name, error.message?.replace(/https?:\/\/\S+/g, '[url]'));
      return json({ error: 'Nie udało się zapisać zmian. Spróbuj ponownie.' }, 500);
    }
  }
  async route(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (method === 'GET' && path === '/api/health') return json({ ok: true, storage: 'sqlite', version: '1' });
    const mutating = !['GET', 'HEAD'].includes(method);
    if (mutating) {
      const origin = request.headers.get('Origin');
      if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, 'Ta operacja wymaga otwarcia aplikacji w jej własnej domenie.');
      if (method !== 'DELETE' && !request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, 'Oczekiwano danych JSON.');
    }
    let body = {};
    if (mutating && method !== 'DELETE') {
      if (Number(request.headers.get('Content-Length')) > 16000) fail(413, 'Przesłany formularz jest za duży.');
      const reader = request.body?.getReader();
      let size = 0, chunks = [];
      if (reader) { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16000) { await reader.cancel(); fail(413, 'Przesłany formularz jest za duży.'); } chunks.push(value); } }
      const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      try { body = JSON.parse(new TextDecoder().decode(data)); } catch { fail(400, 'Niepoprawny formularz. Odśwież stronę i spróbuj ponownie.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Niepoprawny formularz.');
    }
    const ipKey = await digest(request.headers.get('CF-Connecting-IP') || 'unknown');
    if (mutating) this.rateLimit(`write:${ipKey}`, 180, 900);
    if (['/api/create', '/api/join', '/api/login'].includes(path) && method === 'POST') {
      this.rateLimit(`auth:${ipKey}`, 30, 900);
      if (path === '/api/login') {
        const email = text(body.email, 'E-mail', 254, true).toLowerCase();
        if (typeof body.password !== 'string' || body.password.length > 256) fail(400, 'Podaj hasło.');
        const member = this.one('SELECT * FROM members WHERE email=?', email);
        const computed = await passwordHash(body.password, member?.salt || 'missing-user-timing-padding');
        if (!member || !constantEqual(computed, member.password_hash)) fail(401, 'Nieprawidłowy e-mail lub hasło.');
        return this.session(member);
      }
      const input = account(body);
      let family;
      if (path === '/api/create') {
        if (!this.env.SETUP_TOKEN || typeof body.setupToken !== 'string' || !constantEqual(await digest(body.setupToken), await digest(this.env.SETUP_TOKEN))) fail(403, 'Utworzenie rodziny wymaga prywatnego linku startowego.');
        if (this.one('SELECT id FROM family LIMIT 1')) fail(409, 'Rodzina jest już utworzona. Zaloguj się lub poproś o zaproszenie.');
        const name = text(body.familyName, 'Nazwa rodziny', 80, true);
        const invite = random();
        family = { id: crypto.randomUUID(), name, invite, invite_hash: await digest(invite) };
      } else {
        if (typeof body.inviteToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.inviteToken)) fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
        family = this.one('SELECT * FROM family WHERE invite_hash=?', await digest(body.inviteToken));
        if (!family) fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
      }
      const salt = random(), hash = await passwordHash(input.password, salt), id = crypto.randomUUID();
      // Recheck all prerequisites after the asynchronous KDF, inside the transaction.
      this.ctx.storage.transactionSync(() => {
        if (this.one('SELECT id FROM members WHERE email=?', input.email)) fail(409, 'Nie można utworzyć konta z tym adresem. Spróbuj się zalogować.');
        if (this.one('SELECT COUNT(*) AS n FROM members').n >= 100) fail(409, 'Osiągnięto limit członków rodziny.');
        if (path === '/api/create') {
          if (this.one('SELECT id FROM family LIMIT 1')) fail(409, 'Rodzina jest już utworzona.');
          this.sql.exec('INSERT INTO family VALUES(?,?,?,?)', family.id, family.name, family.invite, family.invite_hash);
        } else if (!this.one('SELECT id FROM family WHERE invite_hash=?', family.invite_hash)) fail(404, 'Zaproszenie wygasło. Poproś o nowy link.');
        this.sql.exec('INSERT INTO members(id,family_id,name,email,salt,password_hash,is_admin) VALUES(?,?,?,?,?,?,?)', id, family.id, input.name, input.email, salt, hash, path === '/api/create' ? 1 : 0);
      });
      return this.session(this.one('SELECT * FROM members WHERE id=?', id));
    }
    if (method === 'GET' && /^\/api\/invitation\/[a-f0-9]{64}$/.test(path)) {
      this.rateLimit(`invite:${ipKey}`, 60, 900);
      const family = this.one('SELECT name FROM family WHERE invite_hash=?', await digest(path.split('/').pop()));
      if (!family) fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
      return json({ familyName: family.name });
    }
    const token = request.headers.get('Cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
    const sessionHash = /^[a-f0-9]{64}$/.test(token) ? await digest(token) : '';
    const member = sessionHash ? this.one('SELECT m.* FROM members m JOIN sessions s ON s.member_id=m.id WHERE s.hash=? AND s.expires>?', sessionHash, Math.floor(Date.now() / 1000)) : null;
    if (method === 'GET' && path === '/api/me') return json(member ? this.me(member) : { user: null });
    if (method === 'POST' && path === '/api/logout') {
      this.sql.exec('DELETE FROM sessions WHERE hash=?', sessionHash);
      return json({ ok: true }, 200, { 'Set-Cookie': emptyCookie() });
    }
    if (!member) fail(401, 'Zaloguj się, aby zobaczyć rodzinne listy.');
    if (path === '/api/invite' && ['GET', 'POST'].includes(method)) {
      if (!member.is_admin) fail(403, 'Tylko organizator może zarządzać zaproszeniem.');
      if (method === 'POST') {
        const invite = random(), hash = await digest(invite);
        this.sql.exec('UPDATE family SET invite=?,invite_hash=? WHERE id=?', invite, hash, member.family_id);
      }
      const family = this.one('SELECT invite FROM family WHERE id=?', member.family_id);
      return json({ url: `${url.origin}/#invite=${family.invite}` });
    }
    if (method === 'PATCH' && path === '/api/letter') {
      const letter = text(body.letter, 'List', 4000);
      this.sql.exec('UPDATE members SET letter=? WHERE id=?', letter, member.id);
      return json({ ok: true });
    }
    const listMatch = path.match(/^\/api\/members\/([^/]+)\/wishes$/);
    if (listMatch && method === 'GET') {
      const owner = this.one('SELECT id,name,letter FROM members WHERE id=? AND family_id=?', listMatch[1], member.family_id);
      if (!owner) fail(404, 'Nie znaleziono listu.');
      // Deliberately do not even query the reservation table for the recipient's own list.
      let wishes;
      if (owner.id === member.id) wishes = this.rows('SELECT * FROM wishes WHERE owner_id=? ORDER BY created_at,id', owner.id).map(publicWish);
      // Only the reserver's own snapshot is read; other buyers never get a change flag.
      else wishes = this.rows('SELECT w.*,r.member_id AS buyer,r.purchased,CASE WHEN r.member_id=? THEN r.snapshot END AS snapshot FROM wishes w LEFT JOIN reservations r ON r.wish_id=w.id WHERE w.owner_id=? ORDER BY w.created_at,w.id', member.id, owner.id).map(w => ({
        ...publicWish(w), reserved: Boolean(w.buyer), reservedByMe: w.buyer === member.id, purchased: Boolean(w.purchased),
        ...(w.buyer === member.id && w.snapshot ? { changedSinceReservation: changedSince(JSON.parse(w.snapshot), w) } : {}),
      }));
      return json({ member: owner, wishes });
    }
    if (path === '/api/reservations' && method === 'GET') {
      const wishes = this.rows('SELECT w.*,m.name AS owner_name,r.purchased,r.snapshot FROM reservations r JOIN wishes w ON w.id=r.wish_id JOIN members m ON m.id=w.owner_id WHERE r.member_id=? AND m.family_id=? ORDER BY m.name,w.created_at', member.id, member.family_id).map(w => {
        const original = JSON.parse(w.snapshot);
        const changedSinceReservation = changedSince(original, w);
        return { ...publicWish(w), ...original, ownerName: w.owner_name, purchased: Boolean(w.purchased), changedSinceReservation };
      });
      return json({ wishes });
    }
    if (path === '/api/wishes' && method === 'POST') {
      const w = wishFields(body), id = crypto.randomUUID();
      if (this.one('SELECT COUNT(*) AS n FROM wishes WHERE owner_id=?', member.id).n >= 200) fail(409, 'Twój list może mieć najwyżej 200 życzeń.');
      this.sql.exec('INSERT INTO wishes VALUES(?,?,?,?,?,?,?)', id, member.id, w.title, w.note, w.url, w.price, new Date().toISOString());
      return json({ id }, 201);
    }
    const match = path.match(/^\/api\/wishes\/([^/]+)(\/reserve)?$/);
    if (match) {
      const w = this.one('SELECT w.* FROM wishes w JOIN members m ON m.id=w.owner_id WHERE w.id=? AND m.family_id=?', match[1], member.family_id);
      if (!w) fail(404, 'To życzenie nie jest już dostępne.');
      if (!match[2]) {
        if (w.owner_id !== member.id) fail(403, 'Możesz zmieniać tylko swój list.');
        if (method === 'PATCH') {
          const update = wishFields(body);
          this.sql.exec('UPDATE wishes SET title=?,note=?,url=?,price=? WHERE id=? AND owner_id=?', update.title, update.note, update.url, update.price, w.id, member.id);
          return json({ ok: true });
        }
        if (method === 'DELETE') {
          this.ctx.storage.transactionSync(() => {
            this.sql.exec('DELETE FROM reservations WHERE wish_id=?', w.id);
            this.sql.exec('DELETE FROM wishes WHERE id=? AND owner_id=?', w.id, member.id);
          });
          return json({ ok: true });
        }
      } else {
        if (w.owner_id === member.id) fail(403, 'Nie można rezerwować własnych życzeń.');
        const reservation = this.one('SELECT * FROM reservations WHERE wish_id=?', w.id);
        if (method === 'POST') {
          if (reservation) fail(409, 'Ktoś już zarezerwował ten prezent. Wybierz inne życzenie.');
          // Read and INSERT have no await between them: atomic within this Durable Object.
          const snapshot = JSON.stringify({ title: w.title, note: w.note, url: w.url, price: w.price });
          this.sql.exec('INSERT INTO reservations(wish_id,member_id,purchased,snapshot) VALUES(?,?,0,?)', w.id, member.id, snapshot);
          return json({ ok: true });
        }
        if (!reservation || reservation.member_id !== member.id) fail(403, 'Możesz zmieniać tylko swoje rezerwacje.');
        if (method === 'DELETE') { this.sql.exec('DELETE FROM reservations WHERE wish_id=? AND member_id=?', w.id, member.id); return json({ ok: true }); }
        if (method === 'PATCH') {
          if (typeof body.purchased !== 'boolean') fail(400, 'Niepoprawny status prezentu.');
          this.sql.exec('UPDATE reservations SET purchased=? WHERE wish_id=? AND member_id=?', body.purchased ? 1 : 0, w.id, member.id);
          return json({ ok: true });
        }
      }
    }
    fail(404, 'Nie znaleziono tej strony.');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return env.FAMILY.getByName(env.STORE_NAME || 'family-v1').fetch(request);
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Niedozwolona metoda.' }, 405);
    const assets = {
      '/': [html, 'text/html; charset=utf-8'],
      '/index.html': [html, 'text/html; charset=utf-8'],
      '/app.css': [css, 'text/css; charset=utf-8'],
      '/app.js': [app, 'application/javascript; charset=utf-8'],
      '/favicon.svg': [favicon, 'image/svg+xml'],
      '/robots.txt': ['User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8'],
    };
    const asset = assets[url.pathname];
    if (!asset) return new Response('Nie znaleziono strony.', { status: 404, headers: SECURITY });
    return new Response(request.method === 'HEAD' ? null : asset[0], { headers: { ...SECURITY, 'Content-Type': asset[1], 'Cache-Control': 'no-cache' } });
  },
};
