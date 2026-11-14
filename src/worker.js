import { DurableObject } from 'cloudflare:workers';
import html from '../public/index.html';
import css from '../public/app.css';
import app from '../public/app.js';
import favicon from '../public/favicon.svg';

const encoder = new TextEncoder();
const SESSION_AGE = 60 * 60 * 24 * 30;
const LINK_AGE = 60 * 60 * 24 * 3;
const COOKIE = '__Host-mikolaj';
const TIERS = ['small', 'ok', 'good', 'angel'];
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
const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const now = () => Math.floor(Date.now() / 1000);
const constantEqual = (a, b) => { let diff = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return diff === 0; };
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `Sprawdź pole „${label}” (maks. ${max} znaków).`);
  return value.trim();
}
const email = value => {
  const e = text(value, 'E-mail', 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, 'Podaj poprawny adres e-mail.');
  return e;
};
const password = value => {
  if (typeof value !== 'string' || value.length < 4 || value.length > 256) fail(400, 'Hasło musi mieć co najmniej 4 znaki.');
  return value;
};
function wishFields(body) {
  const title = text(body.title, 'Co chcesz dostać?', 160, true);
  const note = text(body.note ?? '', 'Wskazówki', 1500);
  let url = text(body.url ?? '', 'Link', 2000);
  if (url) {
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); url = parsed.href; }
    catch { fail(400, 'Link musi zaczynać się od https:// lub http://.'); }
  }
  if (!TIERS.includes(body.tier)) fail(400, 'Wybierz, ile prezent może kosztować.');
  return { title, note, url, tier: body.tier };
}
// Stare wpisy miały cenę zamiast przedziału.
const tierOf = price => price == null ? 'ok' : price < 50 ? 'small' : price < 200 ? 'ok' : price <= 300 ? 'good' : 'angel';
const pl = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? few : many;

/* ---------- maile (Resend) ---------- */
const MAIL_FROM = 'Mikołaj <listdo@mikolaja.pl>';
const APP_URL = 'https://list.do.mikolaja.pl';
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
// Ta sama estetyka co strona: biel, ciemna szarość, szeryf w nagłówku, mały prostokątny przycisk.
function mailHtml({ heading, lines = [], quote, button, foot }) {
  const td = (style, inner) => `<tr><td style="${style}">${inner}</td></tr>`;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr><td align="center" style="padding:44px 24px 56px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
${td(`font:400 20px/1 ${SERIF};color:#262626;padding:0 0 52px;`, 'Mikołaj')}
${td(`font:400 36px/1.08 ${SERIF};color:#262626;letter-spacing:-0.5px;padding:0 0 22px;`, escHtml(heading))}
${lines.map(l => td(`font:400 16px/1.6 ${SANS};color:#6b6b6b;padding:0 0 14px;`, escHtml(l))).join('\n')}
${quote ? td(`font:italic 400 18px/1.6 ${SERIF};color:#6b6b6b;padding:14px 0 18px;`, `<span style="color:#262626;">Drogi Mikołaju,</span> ${escHtml(quote)}`) : ''}
${button ? td('padding:18px 0 8px;', `<a href="${escHtml(button.url)}" style="display:inline-block;background:#262626;color:#ffffff;font:500 15px/1 ${SANS};text-decoration:none;padding:13px 18px;border-radius:4px;">${escHtml(button.label)}</a>`) : ''}
${td(`font:400 13px/1.6 ${SANS};color:#8c8c8c;padding:44px 0 0;`, `${foot ? escHtml(foot) + '<br>' : ''}<a href="${APP_URL}" style="color:#8c8c8c;">list.do.mikolaja.pl</a> — rodzinne listy do Mikołaja`)}
</table></td></tr></table></body></html>`;
}
const mailText = ({ heading, lines = [], quote, button, foot }) =>
  [heading, '', ...lines, quote ? `\nDrogi Mikołaju, ${quote}` : '', button ? `\n${button.label}: ${button.url}` : '', '', foot || '', 'list.do.mikolaja.pl — rodzinne listy do Mikołaja'].join('\n').replace(/\n{3,}/g, '\n\n');
async function sendMail(env, to, message) {
  if (!env.RESEND_API_KEY) fail(503, 'Wysyłanie maili nie jest jeszcze włączone.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: message.subject, html: mailHtml(message), text: mailText(message) }),
  });
  // Bez treści i adresów w logach.
  if (!res.ok) { console.error('Mikolaj mail failed', res.status, (await res.json().catch(() => ({}))).name); fail(502, 'Nie udało się wysłać maila. Spróbuj ponownie za chwilę.'); }
}

const cookie = (token, age = SESSION_AGE) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

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
      CREATE TABLE IF NOT EXISTS links (hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS wishes_owner ON wishes(owner_id);
      CREATE INDEX IF NOT EXISTS reservations_member ON reservations(member_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    `);
    // Migracje dodające kolumny — idempotentne, nie ruszają istniejących danych.
    const addColumn = (table, column, type) => {
      if (!this.rows(`PRAGMA table_info(${table})`).some(c => c.name === column)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    };
    addColumn('reservations', 'snapshot', "TEXT NOT NULL DEFAULT '{}'");
    addColumn('members', 'managed_by', 'TEXT');           // osoba bez konta — list prowadzi ten członek
    addColumn('members', 'can_add', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('wishes', 'tier', 'TEXT');
    addColumn('sessions', 'admin_until', 'INTEGER NOT NULL DEFAULT 0'); // tryb organizatora — per sesja, wygasa sam
    this.sql.exec("UPDATE wishes SET tier = CASE WHEN price IS NULL THEN 'ok' WHEN price < 50 THEN 'small' WHEN price < 200 THEN 'ok' WHEN price <= 300 THEN 'good' ELSE 'angel' END WHERE tier IS NULL");
    this.sql.exec("UPDATE reservations SET snapshot=(SELECT json_object('title',title,'note',note,'url',url,'tier',tier) FROM wishes WHERE wishes.id=reservations.wish_id) WHERE snapshot='{}'");
  }
  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  one(query, ...args) { return this.rows(query, ...args)[0]; }
  rateLimit(key, max, seconds) {
    this.sql.exec('DELETE FROM limits WHERE expires < ?', now());
    this.sql.exec('INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, now() + seconds);
    if (this.one('SELECT count FROM limits WHERE key=?', key).count > max) fail(429, 'Za dużo prób. Spróbuj ponownie za kilkanaście minut.');
  }
  async session(member) {
    const token = random();
    this.sql.exec('DELETE FROM sessions WHERE expires < ?', now());
    this.sql.exec('INSERT INTO sessions(hash,member_id,expires) VALUES(?,?,?)', await digest(token), member.id, now() + SESSION_AGE);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(token) });
  }
  async newLink(member) {
    const token = random();
    this.sql.exec('DELETE FROM links WHERE member_id=? OR expires < ?', member.id, now());
    this.sql.exec('INSERT INTO links(hash,member_id,expires) VALUES(?,?,?)', await digest(token), member.id, now() + LINK_AGE);
    return token;
  }
  async link(member, origin) { return json({ url: `${origin}/#link=${await this.newLink(member)}` }); }
  // Raz w roku, trzy tygodnie przed Wigilią: co zostało do kupienia i czy jest list.
  async remind() {
    const year = new Date().getUTCFullYear();
    if (this.one('SELECT key FROM limits WHERE key=?', `remind:${year}`)) return { sent: 0 };
    this.sql.exec('INSERT INTO limits(key,count,expires) VALUES(?,1,?)', `remind:${year}`, now() + 60 * 60 * 24 * 300);
    let sent = 0;
    for (const p of this.rows('SELECT id,name,email,letter FROM members WHERE managed_by IS NULL')) {
      const todo = this.one('SELECT COUNT(*) AS n FROM reservations WHERE member_id=? AND purchased=0', p.id).n;
      const wishes = this.one('SELECT COUNT(*) AS n FROM wishes WHERE owner_id=?', p.id).n;
      const lines = [];
      if (todo) lines.push(`Masz jeszcze ${todo} ${pl(todo, 'prezent', 'prezenty', 'prezentów')} do kupienia.`);
      if (!p.letter && !wishes) lines.push('Nie masz jeszcze listu ani życzeń — bliscy nie wiedzą, co Ci kupić.');
      if (!lines.length) continue;
      try {
        await sendMail(this.env, p.email, { subject: 'Za trzy tygodnie Wigilia', heading: `Za trzy tygodnie Wigilia, ${p.name}`, lines, button: { label: 'Otwórz listy', url: APP_URL } });
        sent++;
      } catch { /* jedna nieudana wysyłka nie zatrzymuje reszty */ }
    }
    return { sent };
  }

  // Codziennie w południe: co nowego dopisano na listach od poprzedniego razu — żeby przypomnieć o kupowaniu.
  // Każdy dostaje tylko cudze, jeszcze wolne życzenia (nie swoje i nie te, które sam wpisał za kogoś).
  async digest() {
    const until = new Date().toISOString();
    const since = this.one("SELECT value FROM meta WHERE key='digest'")?.value || new Date(Date.now() - 864e5).toISOString();
    // Najpierw zapisujemy znacznik — ponowne uruchomienie nie wyśle drugi raz tego samego.
    this.sql.exec("INSERT INTO meta(key,value) VALUES('digest',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", until);
    const fresh = this.rows(`SELECT w.title,w.tier,w.owner_id,m.name AS owner,m.managed_by,m.family_id FROM wishes w JOIN members m ON m.id=w.owner_id
      LEFT JOIN reservations r ON r.wish_id=w.id WHERE w.created_at>? AND w.created_at<=? AND r.wish_id IS NULL ORDER BY m.name,w.created_at`, since, until);
    if (!fresh.length || !this.env.RESEND_API_KEY) return { sent: 0 };
    let sent = 0;
    const families = [...new Set(fresh.map(w => w.family_id))];
    for (const fid of families) {
      for (const p of this.rows('SELECT id,name,email FROM members WHERE family_id=? AND managed_by IS NULL', fid)) {
        const mine = fresh.filter(w => w.family_id === fid && w.owner_id !== p.id && w.managed_by !== p.id);
        if (!mine.length) continue;
        const byOwner = {};
        for (const w of mine) (byOwner[w.owner] ||= []).push(w.title);
        const lines = ['Na listach pojawiły się nowe życzenia — może coś z tego kupisz?', ...Object.entries(byOwner).map(([o, t]) => `${o}: ${t.join(', ')}`)];
        try {
          await sendMail(this.env, p.email, { subject: 'Nowe życzenia na listach', heading: `Cześć, ${p.name}`, lines, button: { label: 'Zobacz listy', url: APP_URL }, foot: 'Pomijamy prezenty, które ktoś już wybrał. Raz dziennie, tylko gdy coś się pojawi.' });
          sent++;
        } catch { /* jedna nieudana wysyłka nie zatrzymuje reszty */ }
      }
    }
    return { sent };
  }

  // Wszystko, czego potrzebuje aplikacja — przycięte do tego, co ta osoba może wiedzieć.
  state(me) {
    const god = this.god(me);
    const family = this.one('SELECT name FROM family WHERE id=?', me.family_id);
    const members = this.rows('SELECT id,name,letter,managed_by FROM members WHERE family_id=? ORDER BY name COLLATE NOCASE', me.family_id)
      .map(m => ({ id: m.id, name: m.name, letter: m.letter, managedBy: m.managed_by }));
    const wishes = this.rows(`SELECT w.id,w.owner_id,w.title,w.note,w.url,w.tier,r.member_id AS buyer,r.purchased,r.snapshot
      FROM wishes w JOIN members m ON m.id=w.owner_id LEFT JOIN reservations r ON r.wish_id=w.id
      WHERE m.family_id=? ORDER BY w.created_at,w.id`, me.family_id).map(w => {
      const wish = { id: w.id, ownerId: w.owner_id, title: w.title, note: w.note, url: w.url, tier: w.tier };
      // Obdarowany nigdy nie dostaje informacji o rezerwacjach na własnej liście.
      if (w.owner_id === me.id || !w.buyer) return wish;
      wish.taken = w.buyer === me.id ? 'me' : 'other';
      if (god) wish.buyerId = w.buyer;
      wish.purchased = Boolean(w.purchased);
      if (w.buyer === me.id) {
        const snap = JSON.parse(w.snapshot || '{}');
        const was = snap.tier ?? tierOf(snap.price);
        if (was !== w.tier) wish.prevTier = was;
      }
      return wish;
    });
    return { user: { id: me.id, name: me.name, email: me.email, isAdmin: Boolean(me.is_admin), canAdd: Boolean(me.can_add || me.is_admin), adminUntil: god ? me.admin_until : 0 }, family, members, wishes };
  }
  god(me) { return Boolean(me.is_admin) && me.admin_until > now(); }
  // Przegląd organizatora — bez rezerwacji na jego własnej liście.
  admin(me, origin) {
    const members = this.rows('SELECT id,name,email,is_admin,can_add,managed_by FROM members WHERE family_id=? ORDER BY name COLLATE NOCASE', me.family_id)
      .map(m => ({ id: m.id, name: m.name, email: m.managed_by ? null : m.email, isAdmin: Boolean(m.is_admin), canAdd: Boolean(m.can_add), managedBy: m.managed_by }));
    // Kto co kupuje — tylko w tymczasowym trybie organizatora.
    const all = !this.god(me) ? [] : this.rows(`SELECT w.id AS wishId,w.title,w.tier,w.owner_id AS ownerId,r.member_id AS buyerId,r.purchased
      FROM reservations r JOIN wishes w ON w.id=r.wish_id JOIN members m ON m.id=w.owner_id WHERE m.family_id=? ORDER BY w.created_at`, me.family_id);
    const hidden = {};
    for (const r of all) if (r.ownerId === me.id) hidden[r.buyerId] = (hidden[r.buyerId] || 0) + 1;
    const reservations = all.filter(r => r.ownerId !== me.id).map(r => ({ ...r, purchased: Boolean(r.purchased) }));
    const invite = this.one('SELECT invite FROM family WHERE id=?', me.family_id).invite;
    return { invite: `${origin}/#invite=${invite}`, members, reservations, hidden, locked: !this.god(me) };
  }

  async fetch(request) {
    try { return await this.route(request); }
    catch (error) {
      if (error instanceof AppError) return json({ error: error.message }, error.status);
      // Nigdy nie logujemy treści, zaproszeń, haseł ani ciasteczek.
      console.error('Mikolaj request failed', error.name, error.message?.replace(/https?:\/\/\S+/g, '[url]'));
      return json({ error: 'Nie udało się zapisać zmian. Spróbuj ponownie.' }, 500);
    }
  }
  async route(request) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (method === 'GET' && path === '/api/health') return json({ ok: true, storage: 'sqlite', version: '2' });
    const mutating = !['GET', 'HEAD'].includes(method);
    let body = {};
    if (mutating) {
      const origin = request.headers.get('Origin');
      if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, 'Ta operacja wymaga otwarcia aplikacji w jej własnej domenie.');
      if (method !== 'DELETE') {
        if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) fail(415, 'Oczekiwano danych JSON.');
        const raw = await request.text();
        if (raw.length > 16000) fail(413, 'Przesłany formularz jest za duży.');
        try { body = JSON.parse(raw || '{}'); } catch { fail(400, 'Niepoprawny formularz. Odśwież stronę i spróbuj ponownie.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Niepoprawny formularz.');
      }
    }
    const ipKey = await digest(request.headers.get('CF-Connecting-IP') || 'unknown');
    if (mutating) this.rateLimit(`write:${ipKey}`, 300, 900);

    // ---------- bez logowania ----------
    if (method === 'POST' && path === '/api/login') {
      this.rateLimit(`auth:${ipKey}`, 30, 900);
      const e = text(body.email, 'E-mail', 254, true).toLowerCase();
      if (typeof body.password !== 'string' || body.password.length > 256) fail(400, 'Podaj hasło.');
      const member = this.one('SELECT * FROM members WHERE email=? AND managed_by IS NULL', e);
      const computed = await passwordHash(body.password, member?.salt || 'missing-user-timing-padding');
      if (!member || !constantEqual(computed, member.password_hash)) fail(401, 'Nieprawidłowy e-mail lub hasło.');
      return this.session(member);
    }
    // Rejestracja: każdy może założyć własną rodzinę i zostaje jej organizatorem.
    if (method === 'POST' && (path === '/api/register' || path === '/api/join')) {
      this.rateLimit(`auth:${ipKey}`, 30, 900);
      const input = { name: text(body.name, 'Imię', 60, true), email: email(body.email), password: password(body.password) };
      const register = path === '/api/register';
      let family;
      if (register) {
        this.rateLimit(`register:${ipKey}`, 5, 3600);
        const invite = random();
        family = { id: crypto.randomUUID(), name: text(body.familyName, 'Nazwa rodziny', 80, true), invite, invite_hash: await digest(invite) };
      } else {
        if (typeof body.inviteToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.inviteToken)) fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
        family = this.one('SELECT * FROM family WHERE invite_hash=?', await digest(body.inviteToken));
        if (!family) fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
      }
      const salt = random(), hash = await passwordHash(input.password, salt), id = crypto.randomUUID();
      // Ponowne sprawdzenie po asynchronicznym KDF, w transakcji.
      this.ctx.storage.transactionSync(() => {
        if (this.one('SELECT id FROM members WHERE email=?', input.email)) fail(409, 'Nie można utworzyć konta z tym adresem. Spróbuj się zalogować.');
        if (register) {
          if (this.one('SELECT COUNT(*) AS n FROM family').n >= 2000) fail(503, 'Chwilowo nie można zakładać nowych rodzin. Spróbuj później.');
          this.sql.exec('INSERT INTO family(id,name,invite,invite_hash) VALUES(?,?,?,?)', family.id, family.name, family.invite, family.invite_hash);
        } else {
          if (!this.one('SELECT id FROM family WHERE invite_hash=?', family.invite_hash)) fail(404, 'Zaproszenie wygasło. Poproś o nowy link.');
          if (this.one('SELECT COUNT(*) AS n FROM members WHERE family_id=?', family.id).n >= 100) fail(409, 'Osiągnięto limit członków rodziny.');
        }
        this.sql.exec('INSERT INTO members(id,family_id,name,email,salt,password_hash,is_admin,can_add) VALUES(?,?,?,?,?,?,?,?)', id, family.id, input.name, input.email, salt, hash, register ? 1 : 0, register ? 1 : 0);
      });
      return this.session(this.one('SELECT * FROM members WHERE id=?', id));
    }
    if (method === 'GET' && /^\/api\/invitation\/[a-f0-9]{64}$/.test(path)) {
      this.rateLimit(`invite:${ipKey}`, 60, 900);
      const family = this.one('SELECT id,name FROM family WHERE invite_hash=?', await digest(path.split('/').pop()));
      if (!family) fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
      const admin = this.one('SELECT name FROM members WHERE family_id=? AND is_admin=1 LIMIT 1', family.id);
      return json({ familyName: family.name, from: admin?.name || null });
    }
    // Zapomniane hasło: link mailem. Odpowiedź zawsze ta sama — nie zdradza, czy konto istnieje.
    if (method === 'POST' && path === '/api/forgot') {
      this.rateLimit(`auth:${ipKey}`, 30, 900);
      this.rateLimit(`forgot:${ipKey}`, 5, 3600);
      const e = email(body.email);
      const m = this.one('SELECT * FROM members WHERE email=? AND managed_by IS NULL', e);
      if (m && this.env.RESEND_API_KEY) {
        this.rateLimit(`forgot-to:${await digest(e)}`, 3, 86400);
        await sendMail(this.env, m.email, {
          subject: 'Nowe hasło do listów do Mikołaja', heading: `Cześć, ${m.name}`,
          lines: ['Ktoś poprosił o nowe hasło do Twojego konta. Jeśli to Ty — kliknij poniżej i ustaw nowe.'],
          button: { label: 'Ustaw nowe hasło', url: `${url.origin}/#link=${await this.newLink(m)}` },
          foot: 'Link działa raz, przez 3 dni. Jeśli to nie Ty, po prostu zignoruj tę wiadomość.',
        });
      }
      return json({ ok: true });
    }
    // Wywołanie z harmonogramu (Worker blokuje /api/internal/ z zewnątrz).
    if (method === 'POST' && path === '/api/internal/remind') return json(await this.remind());
    if (method === 'POST' && path === '/api/internal/digest') return json(await this.digest());

    // Jednorazowy link: nowe hasło albo przejęcie listy prowadzonej przez kogoś innego.
    const linkMatch = path.match(/^\/api\/link\/([a-f0-9]{64})$/);
    if (linkMatch) {
      this.rateLimit(`auth:${ipKey}`, 30, 900);
      const hash = await digest(linkMatch[1]);
      const find = () => this.one('SELECT m.* FROM links l JOIN members m ON m.id=l.member_id WHERE l.hash=? AND l.expires>?', hash, now());
      let member = find();
      if (!member) fail(404, 'Ten link wygasł albo został już użyty. Poproś o nowy.');
      if (method === 'GET') return json({ name: member.name, needsEmail: Boolean(member.managed_by) });
      if (method !== 'POST') fail(405, 'Niedozwolona metoda.');
      const pass = password(body.password);
      const e = member.managed_by ? email(body.email) : member.email;
      const salt = random(), pw = await passwordHash(pass, salt);
      this.ctx.storage.transactionSync(() => {
        member = find();
        if (!member) fail(404, 'Ten link wygasł albo został już użyty.');
        if (this.one('SELECT id FROM members WHERE email=? AND id<>?', e, member.id)) fail(409, 'Ten adres jest już używany.');
        this.sql.exec('UPDATE members SET email=?,salt=?,password_hash=?,managed_by=NULL WHERE id=?', e, salt, pw, member.id);
        this.sql.exec('DELETE FROM links WHERE member_id=?', member.id);
        this.sql.exec('DELETE FROM sessions WHERE member_id=?', member.id);
      });
      return this.session(member);
    }

    // ---------- z logowaniem ----------
    const token = request.headers.get('Cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
    const sessionHash = /^[a-f0-9]{64}$/.test(token) ? await digest(token) : '';
    const me = sessionHash ? this.one('SELECT m.*,s.admin_until FROM members m JOIN sessions s ON s.member_id=m.id WHERE s.hash=? AND s.expires>?', sessionHash, now()) : null;
    if (method === 'GET' && path === '/api/state') return json(me ? { ...this.state(me), mail: Boolean(this.env.RESEND_API_KEY) } : { user: null, mail: Boolean(this.env.RESEND_API_KEY) });
    if (method === 'POST' && path === '/api/logout') {
      this.sql.exec('DELETE FROM sessions WHERE hash=?', sessionHash);
      return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
    }
    if (!me) fail(401, 'Zaloguj się, aby zobaczyć rodzinne listy.');

    const member = id => this.one('SELECT * FROM members WHERE id=? AND family_id=?', id, me.family_id) || fail(404, 'Nie znaleziono tej osoby.');
    const god = this.god(me);
    const canEdit = m => m.id === me.id || m.managed_by === me.id || god;
    const adminOnly = () => { if (!me.is_admin) fail(403, 'To może zrobić tylko organizator rodziny.'); };

    if (method === 'GET' && path === '/api/admin') { adminOnly(); return json(this.admin(me, url.origin)); }
    // Tryb organizatora: włączany ręcznie, tylko w tej sesji, wyłącza się sam po godzinie.
    if (method === 'PATCH' && path === '/api/session') {
      adminOnly();
      this.sql.exec('UPDATE sessions SET admin_until=? WHERE hash=?', body.adminMode === true ? now() + 3600 : 0, sessionHash);
      return json({ ok: true });
    }
    if (method === 'POST' && path === '/api/invite/email') {
      adminOnly();
      this.rateLimit(`invite-mail:${me.id}`, 30, 86400);
      const to = email(body.email);
      const family = this.one('SELECT name,invite FROM family WHERE id=?', me.family_id);
      await sendMail(this.env, to, {
        subject: `${me.name} zaprasza Cię do listów do Mikołaja`, heading: 'Zaproszenie',
        lines: [`${me.name} zaprasza Cię do rodziny ${family.name} — do wspólnych list do Mikołaja.`, 'Każdy pisze list i życzenia, a bliscy wybierają prezenty tak, żeby nikt nie kupił tego samego. Niespodzianka zostaje niespodzianką.'],
        button: { label: 'Dołączam', url: `${url.origin}/#invite=${family.invite}` },
        foot: 'Jeśli nie znasz nadawcy, zignoruj tę wiadomość.',
      });
      return json({ ok: true });
    }
    if (method === 'POST' && path === '/api/invite') {
      adminOnly();
      const invite = random();
      this.sql.exec('UPDATE family SET invite=?,invite_hash=? WHERE id=?', invite, await digest(invite), me.family_id);
      return json({ ok: true });
    }

    // osoby
    if (method === 'POST' && path === '/api/members') {
      if (!me.can_add && !me.is_admin) fail(403, 'Nie możesz dodawać osób. Poproś organizatora.');
      const name = text(body.name, 'Imię', 60, true), id = crypto.randomUUID();
      if (this.one('SELECT COUNT(*) AS n FROM members WHERE family_id=?', me.family_id).n >= 100) fail(409, 'Osiągnięto limit członków rodziny.');
      // Osoba bez konta: adres zastępczy i puste hasło — nie da się na nią zalogować.
      this.sql.exec('INSERT INTO members(id,family_id,name,email,salt,password_hash,managed_by) VALUES(?,?,?,?,?,?,?)', id, me.family_id, name, `managed:${id}`, '', '', me.id);
      return json({ id }, 201);
    }
    const memberMatch = path.match(/^\/api\/members\/([^/]+)(\/letter|\/link)?$/);
    if (memberMatch) {
      const target = member(memberMatch[1]);
      if (memberMatch[2] === '/letter' && method === 'PATCH') {
        if (!canEdit(target)) fail(403, 'Możesz zmieniać tylko swój list i listy osób, które prowadzisz.');
        this.sql.exec('UPDATE members SET letter=? WHERE id=?', text(body.letter, 'List', 4000), target.id);
        return json({ ok: true });
      }
      if (memberMatch[2] === '/link' && method === 'POST') {
        if (!me.is_admin && target.managed_by !== me.id) fail(403, 'Brak uprawnień.');
        return this.link(target, url.origin);
      }
      if (!memberMatch[2] && method === 'PATCH') {
        adminOnly();
        if (typeof body.canAdd === 'boolean') this.sql.exec('UPDATE members SET can_add=? WHERE id=?', body.canAdd ? 1 : 0, target.id);
        if (body.managedBy !== undefined) {
          if (!target.managed_by) fail(400, 'Ta osoba ma własne konto.');
          const manager = member(body.managedBy);
          if (manager.managed_by) fail(400, 'Opiekun musi mieć własne konto.');
          this.sql.exec('UPDATE members SET managed_by=? WHERE id=?', manager.id, target.id);
        }
        if (body.admin === true) {
          if (target.managed_by) fail(400, 'Organizator musi mieć własne konto.');
          this.ctx.storage.transactionSync(() => {
            this.sql.exec('UPDATE members SET is_admin=0 WHERE family_id=?', me.family_id);
            this.sql.exec('UPDATE members SET is_admin=1 WHERE id=?', target.id);
          });
        }
        return json({ ok: true });
      }
      if (!memberMatch[2] && method === 'DELETE') {
        if (target.id === me.id) fail(400, 'Nie możesz usunąć siebie.');
        if (!me.is_admin && target.managed_by !== me.id) fail(403, 'Brak uprawnień.');
        this.ctx.storage.transactionSync(() => {
          this.sql.exec('DELETE FROM reservations WHERE member_id=? OR wish_id IN (SELECT id FROM wishes WHERE owner_id=?)', target.id, target.id);
          this.sql.exec('DELETE FROM wishes WHERE owner_id=?', target.id);
          this.sql.exec('DELETE FROM sessions WHERE member_id=?', target.id);
          this.sql.exec('DELETE FROM links WHERE member_id=?', target.id);
          this.sql.exec('UPDATE members SET managed_by=? WHERE managed_by=?', me.id, target.id);
          this.sql.exec('DELETE FROM members WHERE id=?', target.id);
        });
        return json({ ok: true });
      }
    }

    // życzenia
    if (method === 'POST' && path === '/api/wishes') {
      const owner = member(body.ownerId || me.id);
      if (!canEdit(owner)) fail(403, 'Możesz dodawać życzenia tylko na swoją listę i listy osób, które prowadzisz.');
      const w = wishFields(body), id = crypto.randomUUID();
      if (this.one('SELECT COUNT(*) AS n FROM wishes WHERE owner_id=?', owner.id).n >= 200) fail(409, 'Lista może mieć najwyżej 200 życzeń.');
      this.sql.exec('INSERT INTO wishes(id,owner_id,title,note,url,tier,created_at) VALUES(?,?,?,?,?,?,?)', id, owner.id, w.title, w.note, w.url, w.tier, new Date().toISOString());
      return json({ id }, 201);
    }
    const match = path.match(/^\/api\/wishes\/([^/]+)(\/reserve)?$/);
    if (match) {
      const w = this.one('SELECT w.*,m.managed_by FROM wishes w JOIN members m ON m.id=w.owner_id WHERE w.id=? AND m.family_id=?', match[1], me.family_id);
      if (!w) fail(404, 'To życzenie nie jest już dostępne.');
      if (!match[2]) {
        if (w.owner_id !== me.id && w.managed_by !== me.id && !god) fail(403, 'Możesz zmieniać tylko swoją listę.');
        if (method === 'PATCH') {
          const u = wishFields(body);
          this.sql.exec('UPDATE wishes SET title=?,note=?,url=?,tier=? WHERE id=?', u.title, u.note, u.url, u.tier, w.id);
          return json({ ok: true });
        }
        if (method === 'DELETE') {
          this.ctx.storage.transactionSync(() => {
            this.sql.exec('DELETE FROM reservations WHERE wish_id=?', w.id);
            this.sql.exec('DELETE FROM wishes WHERE id=?', w.id);
          });
          return json({ ok: true });
        }
      } else {
        if (w.owner_id === me.id) fail(403, 'Nie można rezerwować własnych życzeń.');
        const reservation = this.one('SELECT * FROM reservations WHERE wish_id=?', w.id);
        if (method === 'POST') {
          // Organizator w swoim trybie może przypisać prezent komuś innemu (albo przepisać rezerwację).
          let buyer = me;
          if (body.buyerId && body.buyerId !== me.id) {
            if (!god) fail(403, 'Przypisywanie prezentów innym wymaga trybu organizatora.');
            buyer = member(body.buyerId);
            if (buyer.managed_by) fail(400, 'Prezenty kupują osoby z własnym kontem.');
            if (buyer.id === w.owner_id) fail(400, 'Nikt nie kupuje prezentu sam sobie.');
          }
          if (reservation && !god) fail(409, 'Ktoś już wybrał ten prezent. Wybierz inny.');
          const snap = JSON.stringify({ title: w.title, note: w.note, url: w.url, tier: w.tier });
          // Odczyt i zapis bez await pomiędzy — atomowe w obrębie Durable Object.
          if (reservation) this.sql.exec('UPDATE reservations SET member_id=?,snapshot=? WHERE wish_id=?', buyer.id, snap, w.id);
          else this.sql.exec('INSERT INTO reservations(wish_id,member_id,purchased,snapshot) VALUES(?,?,0,?)', w.id, buyer.id, snap);
          return json({ ok: true });
        }
        if (!reservation || (reservation.member_id !== me.id && !god)) fail(403, 'Możesz zmieniać tylko swoje rezerwacje.');
        if (method === 'DELETE') { this.sql.exec('DELETE FROM reservations WHERE wish_id=?', w.id); return json({ ok: true }); }
        if (method === 'PATCH') {
          if (typeof body.purchased !== 'boolean') fail(400, 'Niepoprawny status prezentu.');
          this.sql.exec('UPDATE reservations SET purchased=? WHERE wish_id=?', body.purchased ? 1 : 0, w.id);
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
    // Stary adres — przenosimy na nowy (fragment #invite=… przeglądarka zachowuje sama).
    if (url.hostname === 'mikolaj.walasek.xyz' && url.pathname !== '/version.json') {
      return Response.redirect(`https://list.do.mikolaja.pl${url.pathname}${url.search}`, url.pathname.startsWith('/api/') ? 308 : 301);
    }
    if (url.pathname === '/version.json') {
      if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Niedozwolona metoda.' }, 405);
      const response = json({ revision: env.DEPLOY_REVISION || 'manual', branch: env.DEPLOY_BRANCH || null });
      return request.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response;
    }
    if (url.pathname.startsWith('/api/internal/')) return json({ error: 'Nie znaleziono tej strony.' }, 404);
    if (url.pathname.startsWith('/api/')) return env.FAMILY.getByName(env.STORE_NAME || 'family-v1').fetch(request);
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Niedozwolona metoda.' }, 405);
    const assets = {
      '/': [html, 'text/html; charset=utf-8'],
      '/app.css': [css, 'text/css; charset=utf-8'],
      '/app.js': [app, 'application/javascript; charset=utf-8'],
      '/favicon.svg': [favicon, 'image/svg+xml'],
      '/robots.txt': ['User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8'],
    };
    const asset = assets[url.pathname];
    if (!asset) return new Response('Nie znaleziono strony.', { status: 404, headers: SECURITY });
    const headers = { ...SECURITY, 'Content-Type': asset[1], 'Cache-Control': 'no-cache' };
    if (asset[0] === html && request.method === 'GET') {
      // Nonce na odpowiedź — Cloudflare może wstrzyknąć swój skrypt bez 'unsafe-inline'.
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      const body = html.replace('<script type="module" src="/app.js"></script>', `<script type="module" src="/app.js" nonce="${nonce}"></script>`);
      return new Response(body, { headers: { ...headers, 'Content-Security-Policy': SECURITY['Content-Security-Policy'].replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`) } });
    }
    return new Response(request.method === 'HEAD' ? null : asset[0], { headers });
  },
  // Harmonogram: 3 grudnia — przypomnienie przed Wigilią; codziennie w południe — nowe życzenia.
  async scheduled(controller, env, ctx) {
    const job = controller.cron === '0 9 3 12 *' ? 'remind' : 'digest';
    const request = new Request(`https://internal.invalid/api/internal/${job}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    ctx.waitUntil(env.FAMILY.getByName(env.STORE_NAME || 'family-v1').fetch(request));
  },
};
