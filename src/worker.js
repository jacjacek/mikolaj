import { DurableObject } from 'cloudflare:workers';
const encoder = new TextEncoder();
const SESSION_AGE = 60 * 60 * 24 * 90; // odnawiana przy każdym otwarciu aplikacji
const LINK_AGE = 60 * 60 * 24 * 3;
const COOKIE = '__Host-mikolaj';
const TIERS = ['small', 'ok', 'good', 'angel'];
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'",
};
class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new AppError(status, message); };
const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { ...SECURITY, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...headers } });
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
// pole jednowierszowe (imię, nazwa, tytuł): bez znaków nowej linii i sterujących
const line = (...args) => text(...args).replace(/\s+/g, ' ');
const inviteToken = value => (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) ? digest(value) : fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
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
  const title = line(body.title, 'Co chcesz dostać?', 160, true);
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
// Włączone, gdy są RESEND_API_KEY i MAIL_FROM. Każda wiadomość niesie `base` — adres aplikacji do linków.
const mailOn = env => Boolean(env.RESEND_API_KEY && env.MAIL_FROM);
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
// Ta sama estetyka co strona: biel, ciemna szarość, szeryf w nagłówku, mały prostokątny przycisk.
function mailHtml({ heading, lines = [], quote, button, foot, off, base }) {
  const site = new URL(base).host;
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
${td(`font:400 13px/1.6 ${SANS};color:#8c8c8c;padding:44px 0 0;`, `${foot ? escHtml(foot) + '<br>' : ''}${off ? `<a href="${escHtml(off)}" style="color:#8c8c8c;">Nie chcę dostawać tych maili</a><br>` : ''}<a href="${escHtml(base)}" style="color:#8c8c8c;">${escHtml(site)}</a> — rodzinne listy do Mikołaja`)}
</table></td></tr></table></body></html>`;
}
const mailText = ({ heading, lines = [], quote, button, foot, off, base }) =>
  [heading, '', ...lines, quote ? `\nDrogi Mikołaju, ${quote}` : '', button ? `\n${button.label}: ${button.url}` : '', '', foot || '', off ? `Nie chcę dostawać tych maili: ${off}` : '', `${new URL(base).host} — rodzinne listy do Mikołaja`].join('\n').replace(/\n{3,}/g, '\n\n');
async function sendMail(env, to, message) {
  if (!mailOn(env)) fail(503, 'Wysyłanie maili nie jest włączone.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: message.subject, html: mailHtml(message), text: mailText(message) }),
  });
  // Bez treści i adresów w logach.
  if (!res.ok) { console.error('Mikolaj mail failed', res.status, (await res.json().catch(() => ({}))).name); fail(502, 'Nie udało się wysłać maila. Spróbuj ponownie za chwilę.'); }
}

const cookie = (token, age = SESSION_AGE) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

const SCHEMA = 2;
export class FamilyStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; this.env = env; this.sql = ctx.storage.sql;
    // Aktualny kształt bazy. Konto (e-mail + hasło) jest osobno od członkostwa — jedna osoba może być w wielu
    // rodzinach, w każdej z własnym listem, życzeniami i rolą; sesja wskazuje aktywne członkostwo.
    // Zaszłości zostawione celowo (dane nigdy nie są usuwane): members.email/salt/password_hash to zaślepki
    // sprzed tabeli accounts, wishes.price — cena sprzed przedziałów,
    // members.can_add — dawne uprawnienie do dodawania osób (dziś może każdy).
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS family (id TEXT PRIMARY KEY, name TEXT NOT NULL, invite TEXT NOT NULL, invite_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, last_member TEXT, mails INTEGER NOT NULL DEFAULT 1, mail_token TEXT);
      CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES family(id), name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, letter TEXT NOT NULL DEFAULT '', managed_by TEXT, can_add INTEGER NOT NULL DEFAULT 0, account_id TEXT);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, expires INTEGER NOT NULL, admin_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS wishes (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', price REAL, created_at TEXT NOT NULL, tier TEXT);
      CREATE TABLE IF NOT EXISTS reservations (wish_id TEXT PRIMARY KEY REFERENCES wishes(id) ON DELETE CASCADE, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, purchased INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL DEFAULT '{}', reserved_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS links (hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    `);
    // Starsze bazy dochodzą do tego kształtu migracjami — każda biegnie raz, numer wersji leży w meta.
    const version = Number(this.one("SELECT value FROM meta WHERE key='schema'")?.value || 0);
    if (version < SCHEMA) ctx.storage.transactionSync(() => {
      this.migrate(version);
      this.sql.exec("INSERT INTO meta(key,value) VALUES('schema',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(SCHEMA));
    });
  }
  // Migracje tylko dodają kolumny i uzupełniają dane; są idempotentne.
  migrate(from) {
    const addColumn = (table, column, type) => {
      if (!this.rows(`PRAGMA table_info(${table})`).some(c => c.name === column)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    };
    if (from < 1) {
      addColumn('reservations', 'snapshot', "TEXT NOT NULL DEFAULT '{}'");
      addColumn('members', 'managed_by', 'TEXT');
      addColumn('members', 'can_add', 'INTEGER NOT NULL DEFAULT 0');
      addColumn('wishes', 'tier', 'TEXT');
      addColumn('reservations', 'reserved_at', 'INTEGER NOT NULL DEFAULT 0');
      addColumn('sessions', 'admin_until', 'INTEGER NOT NULL DEFAULT 0');
      addColumn('members', 'account_id', 'TEXT');
      // Każdy dotychczasowy członek z własnym logowaniem dostaje konto o tym samym id.
      const legacy = 'managed_by IS NULL AND account_id IS NULL';
      this.sql.exec(`INSERT INTO accounts(id,email,salt,password_hash,last_member) SELECT id,email,salt,password_hash,id FROM members WHERE ${legacy}`);
      this.sql.exec(`UPDATE members SET account_id=id WHERE ${legacy}`);
      this.sql.exec("UPDATE wishes SET tier = CASE WHEN price IS NULL THEN 'ok' WHEN price < 50 THEN 'small' WHEN price < 200 THEN 'ok' WHEN price <= 300 THEN 'good' ELSE 'angel' END WHERE tier IS NULL");
      this.sql.exec("UPDATE reservations SET snapshot=(SELECT json_object('title',title,'note',note,'url',url,'tier',tier) FROM wishes WHERE wishes.id=reservations.wish_id) WHERE snapshot='{}'");
    }
    if (from < 2) {
      addColumn('accounts', 'mails', 'INTEGER NOT NULL DEFAULT 1');   // 0 — bez przypomnień mailem
      addColumn('accounts', 'mail_token', 'TEXT');                    // sekret w linku „nie chcę tych maili”
    }
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS wishes_owner ON wishes(owner_id);
      CREATE INDEX IF NOT EXISTS reservations_member ON reservations(member_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
      CREATE INDEX IF NOT EXISTS members_account ON members(account_id);
    `);
  }
  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  one(query, ...args) { return this.rows(query, ...args)[0]; }
  rateLimit(key, max, seconds) {
    this.sql.exec('DELETE FROM limits WHERE expires < ?', now());
    this.sql.exec('INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', key, now() + seconds);
    if (this.one('SELECT count FROM limits WHERE key=?', key).count > max) fail(429, 'Za dużo prób. Spróbuj ponownie za kilkanaście minut.');
  }
  // Adres aplikacji do linków: stały z konfiguracji albo ten, pod którym przyszło żądanie.
  base(url) { return this.env.APP_URL?.replace(/\/+$/, '') || url?.origin; }
  // Zakładanie rodzin: otwarte dla wszystkich albo — domyślnie — tylko pierwsza rodzina w tej instalacji.
  canRegister() { return this.env.OPEN_REGISTRATION === 'true' || !this.one('SELECT 1 AS x FROM family LIMIT 1'); }
  who(sessionHash) {
    return sessionHash ? this.one('SELECT m.*,s.admin_until,s.expires,a.email AS login,a.mails FROM sessions s JOIN members m ON m.id=s.member_id JOIN accounts a ON a.id=m.account_id WHERE s.hash=? AND s.expires>?', sessionHash, now()) : null;
  }
  // Konto dla e-maila i hasła: istniejące (hasło musi pasować) albo dane nowego.
  // KDF jest asynchroniczny, więc wynik potwierdza claim() — już w transakcji.
  async credentials(mail, pass, wrong) {
    this.rateLimit(`login:${await digest(mail)}`, 20, 900);
    const existing = this.one('SELECT * FROM accounts WHERE email=?', mail);
    const salt = existing?.salt || random(), hash = await passwordHash(pass, salt);
    if (existing && !constantEqual(hash, existing.password_hash)) fail(409, wrong);
    return existing || { id: crypto.randomUUID(), email: mail, salt, password_hash: hash, fresh: true };
  }
  claim(account) {
    if (!account.fresh) {
      if (this.one('SELECT password_hash FROM accounts WHERE id=?', account.id)?.password_hash !== account.password_hash) fail(409, 'Dane logowania zmieniły się. Spróbuj ponownie.');
    } else {
      if (this.one('SELECT id FROM accounts WHERE email=?', account.email)) fail(409, 'Ten adres ma już konto. Spróbuj się zalogować.');
      this.sql.exec('INSERT INTO accounts(id,email,salt,password_hash) VALUES(?,?,?,?)', account.id, account.email, account.salt, account.password_hash);
    }
  }
  // Członkostwo konta, w które wchodzimy: wskazane, ostatnio używane albo pierwsze.
  pickMember(accountId, preferred) {
    return (preferred && this.one('SELECT id FROM members WHERE id=? AND account_id=?', preferred, accountId))
      || this.one('SELECT m.id FROM members m JOIN accounts a ON a.id=m.account_id WHERE a.id=? ORDER BY m.id=a.last_member DESC, m.rowid LIMIT 1', accountId);
  }
  async session(account, memberId) {
    const token = random();
    const hash = await digest(token);
    this.ctx.storage.transactionSync(() => {
      const current = this.one('SELECT password_hash FROM accounts WHERE id=?', account.id);
      if (!current || current.password_hash !== account.password_hash) fail(401, 'Dane logowania zmieniły się. Zaloguj się ponownie.');
      const m = this.pickMember(account.id, memberId);
      if (!m) fail(401, 'To konto nie należy już do żadnej rodziny. Poproś bliskich o nowe zaproszenie.');
      this.sql.exec('DELETE FROM sessions WHERE expires < ?', now());
      this.sql.exec('INSERT INTO sessions(hash,member_id,expires) VALUES(?,?,?)', hash, m.id, now() + SESSION_AGE);
      this.sql.exec('UPDATE accounts SET last_member=? WHERE id=?', m.id, account.id);
    });
    return json({ ok: true, state: this.state(this.who(hash)) }, 200, { 'Set-Cookie': cookie(token) });
  }
  async newFamily(name) {
    const invite = random();
    return { id: crypto.randomUUID(), name: line(name, 'Nazwa rodziny', 80, true), invite, invite_hash: await digest(invite) };
  }
  insertFamily(f) { // w transakcji
    if (!this.canRegister()) fail(403, 'Zakładanie nowych rodzin jest tu wyłączone. Poproś bliskich o zaproszenie.');
    if (this.one('SELECT COUNT(*) AS n FROM family').n >= 2000) fail(503, 'Chwilowo nie można zakładać nowych rodzin. Spróbuj później.');
    this.sql.exec('INSERT INTO family(id,name,invite,invite_hash) VALUES(?,?,?,?)', f.id, f.name, f.invite, f.invite_hash);
  }
  // Nowe członkostwo konta w rodzinie (wywoływać w transakcji). Kolumny email/hasło w members są tylko zaślepką.
  addMembership(familyId, accountId, name, admin) {
    if (this.one('SELECT id FROM members WHERE family_id=? AND account_id=?', familyId, accountId)) fail(409, 'Już jesteś w tej rodzinie.');
    if (this.one('SELECT COUNT(*) AS n FROM members WHERE family_id=?', familyId).n >= 100) fail(409, 'Osiągnięto limit członków rodziny.');
    const id = crypto.randomUUID();
    this.sql.exec('INSERT INTO members(id,family_id,name,email,salt,password_hash,is_admin,can_add,account_id) VALUES(?,?,?,?,?,?,?,?,?)', id, familyId, name, `acct:${id}`, '', '', admin ? 1 : 0, admin ? 1 : 0, accountId);
    return id;
  }
  async newLink(member) {
    const token = random();
    const hash = await digest(token);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM links WHERE member_id=? OR expires < ?', member.id, now());
      this.sql.exec('INSERT INTO links(hash,member_id,expires) VALUES(?,?,?)', hash, member.id, now() + LINK_AGE);
    });
    return token;
  }
  // Link „nie chcę tych maili” — sekret konta, tworzony przy pierwszej wysyłce.
  offLink(acct, base) {
    if (!acct.mail_token) { acct.mail_token = random(); this.sql.exec('UPDATE accounts SET mail_token=? WHERE id=?', acct.mail_token, acct.id); }
    return `${base}/#nomail=${acct.mail_token}`;
  }
  // Raz w roku, trzy tygodnie przed Wigilią: co zostało do kupienia i czy jest list. Woła harmonogram (RPC).
  async remind() {
    const year = String(new Date().getUTCFullYear()), base = this.base();
    if (!mailOn(this.env) || !base || this.one("SELECT value FROM meta WHERE key='remind'")?.value === year) return { sent: 0 };
    this.sql.exec("INSERT INTO meta(key,value) VALUES('remind',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", year);
    let sent = 0;
    // Jeden mail na konto — z każdej rodziny, w której ta osoba jest.
    for (const acct of this.rows('SELECT id,email,mail_token FROM accounts WHERE mails=1')) {
      const ms = this.memberships(acct.id);
      if (!ms.length) continue;
      const lines = [];
      for (const p of ms) {
        const todo = this.one('SELECT COUNT(*) AS n FROM reservations WHERE member_id=? AND purchased=0', p.id).n;
        const wishes = this.one('SELECT COUNT(*) AS n FROM wishes WHERE owner_id=?', p.id).n;
        const where = ms.length > 1 ? `${p.family}: ` : '';
        if (todo) lines.push(`${where}${ms.length > 1 ? 'masz' : 'Masz'} jeszcze ${todo} ${pl(todo, 'prezent', 'prezenty', 'prezentów')} do kupienia.`);
        if (!p.letter && !wishes) lines.push(`${where}${ms.length > 1 ? 'nie masz' : 'Nie masz'} jeszcze listu ani życzeń — bliscy nie wiedzą, co Ci kupić.`);
      }
      if (!lines.length) continue;
      try {
        await sendMail(this.env, acct.email, { subject: 'Za trzy tygodnie Wigilia', heading: `Za trzy tygodnie Wigilia, ${ms[0].name}`, lines, button: { label: 'Otwórz listy', url: base }, off: this.offLink(acct, base), base });
        sent++;
      } catch { /* jedna nieudana wysyłka nie zatrzymuje reszty */ }
    }
    return { sent };
  }

  // Codziennie w południe, jeden mail na osobę (tylko gdy jest o czym pisać). Woła harmonogram (RPC).
  //  1) prezenty, które od poprzedniego razu wybrałem do kupienia i jeszcze nie kupiłem — przypomnienie,
  //  2) nowe, wolne życzenia innych (nie moje i nie te, które sam wpisałem za kogoś).
  async digest() {
    const until = new Date().toISOString();
    const since = this.one("SELECT value FROM meta WHERE key='digest'")?.value || new Date(Date.now() - 864e5).toISOString();
    // Najpierw zapisujemy znacznik — ponowne uruchomienie nie wyśle drugi raz tego samego.
    this.sql.exec("INSERT INTO meta(key,value) VALUES('digest',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", until);
    const base = this.base();
    if (!mailOn(this.env) || !base) return { sent: 0 };
    const fresh = this.rows(`SELECT w.title,w.owner_id,m.name AS owner,m.managed_by,m.family_id FROM wishes w JOIN members m ON m.id=w.owner_id
      LEFT JOIN reservations r ON r.wish_id=w.id WHERE w.created_at>? AND w.created_at<=? AND r.wish_id IS NULL ORDER BY m.name,w.created_at`, since, until);
    const picks = this.rows(`SELECT r.member_id,w.title,w.owner_id,m.name AS owner,m.family_id FROM reservations r JOIN wishes w ON w.id=r.wish_id JOIN members m ON m.id=w.owner_id
      WHERE r.reserved_at>=? AND r.reserved_at<? AND r.purchased=0 ORDER BY m.name,w.created_at`, Math.floor(Date.parse(since) / 1000), Math.floor(Date.parse(until) / 1000));
    const families = [...new Set([...fresh, ...picks].map(x => x.family_id))];
    const byOwner = list => {
      const groups = new Map();
      for (const item of list) {
        const key = item.owner_id;
        if (!groups.has(key)) groups.set(key, { name: item.owner, titles: [] });
        groups.get(key).titles.push(item.title);
      }
      return [...groups.values()].map(g => `${g.name}: ${g.titles.join(', ')}`);
    };
    let sent = 0;
    // Jeden mail na konto; przy kilku rodzinach każda ma swój nagłówek.
    const accounts = families.length ? this.rows(`SELECT DISTINCT a.id,a.email,a.mail_token FROM accounts a JOIN members m ON m.account_id=a.id
      WHERE a.mails=1 AND m.family_id IN (SELECT value FROM json_each(?))`, JSON.stringify(families)) : [];
    for (const acct of accounts) {
      const ms = this.memberships(acct.id);
      const lines = [];
      let anyMine = false;
      for (const p of ms) {
        const mine = picks.filter(x => x.member_id === p.id);
        const news = fresh.filter(w => w.family_id === p.family_id && w.owner_id !== p.id && w.managed_by !== p.id);
        if (!mine.length && !news.length) continue;
        const todo = this.one('SELECT COUNT(*) AS n FROM reservations WHERE member_id=? AND purchased=0', p.id).n;
        if (ms.length > 1) lines.push(`— ${p.family} —`);
        if (mine.length) { anyMine = true; lines.push('Pamiętaj — kupujesz:', ...byOwner(mine), `Wszystkich prezentów do kupienia: ${todo}.`); }
        if (news.length) lines.push(mine.length ? 'Na listach pojawiły się też nowe życzenia:' : 'Na listach pojawiły się nowe życzenia — może coś z tego kupisz?', ...byOwner(news));
      }
      if (!lines.length) continue;
      const common = { heading: `Cześć, ${ms[0].name}`, lines, off: this.offLink(acct, base), base };
      try {
        await sendMail(this.env, acct.email, anyMine
          ? { ...common, subject: 'Pamiętaj o prezentach do kupienia', button: { label: 'Otwórz Kupuję', url: `${base}/#/kupuje` }, foot: 'Gdy coś kupisz, oznacz to w zakładce Kupuję. Raz dziennie, tylko gdy jest o czym przypomnieć.' }
          : { ...common, subject: 'Nowe życzenia na listach', button: { label: 'Zobacz listy', url: base }, foot: 'Pomijamy prezenty, które ktoś już kupuje. Raz dziennie, tylko gdy coś się pojawi.' });
        sent++;
      } catch { /* jedna nieudana wysyłka nie zatrzymuje reszty */ }
    }
    return { sent };
  }
  // Usunięcie członka z rodziny (w transakcji): list, życzenia i rezerwacje znikają,
  // prowadzone przez niego osoby przechodzą do `heirId`.
  removeMember(target, heirId) {
    this.sql.exec('DELETE FROM reservations WHERE member_id=? OR wish_id IN (SELECT id FROM wishes WHERE owner_id=?)', target.id, target.id);
    this.sql.exec('DELETE FROM wishes WHERE owner_id=?', target.id);
    // Konto w innych rodzinach zostaje zalogowane — sesje przechodzą do innej jego rodziny.
    const other = target.account_id && this.one('SELECT id FROM members WHERE account_id=? AND id<>? ORDER BY rowid LIMIT 1', target.account_id, target.id);
    if (other) {
      this.sql.exec('UPDATE sessions SET member_id=?,admin_until=0 WHERE member_id=?', other.id, target.id);
      this.sql.exec('UPDATE accounts SET last_member=? WHERE id=? AND last_member=?', other.id, target.account_id, target.id);
    } else this.sql.exec('DELETE FROM sessions WHERE member_id=?', target.id);
    this.sql.exec('DELETE FROM links WHERE member_id=?', target.id);
    this.sql.exec('UPDATE members SET managed_by=? WHERE managed_by=?', heirId, target.id);
    this.sql.exec('DELETE FROM members WHERE id=?', target.id);
    // Ostatnia rodzina — konto znika razem z nią, jak dotąd.
    if (target.account_id && !other) this.sql.exec('DELETE FROM accounts WHERE id=?', target.account_id);
  }
  // Wszystkie rodziny konta (członkostwa), od najstarszego.
  memberships(accountId) {
    return this.rows('SELECT m.id,m.name,m.letter,m.family_id,m.is_admin,f.name AS family FROM members m JOIN family f ON f.id=m.family_id WHERE m.account_id=? ORDER BY m.rowid', accountId);
  }

  // Wszystko, czego potrzebuje aplikacja — przycięte do tego, co ta osoba może wiedzieć.
  state(me) {
    const flags = { mail: mailOn(this.env), register: this.canRegister() };
    if (!me) return { user: null, ...flags };
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
        if (snap.title && snap.title !== w.title) wish.prevTitle = snap.title;
      }
      return wish;
    });
    const families = this.memberships(me.account_id).map(m => ({ memberId: m.id, name: m.family, isAdmin: Boolean(m.is_admin) }));
    return { user: { id: me.id, name: me.name, email: me.login, isAdmin: Boolean(me.is_admin), adminUntil: god ? me.admin_until : 0, mails: Boolean(me.mails) }, family, families, members, wishes, ...flags };
  }
  god(me) { return Boolean(me.is_admin) && me.admin_until > now(); }
  // Przegląd organizatora — bez rezerwacji na jego własnej liście.
  admin(me, origin) {
    const members = this.rows('SELECT m.id,m.name,a.email AS login,m.is_admin,m.managed_by FROM members m LEFT JOIN accounts a ON a.id=m.account_id WHERE m.family_id=? ORDER BY m.name COLLATE NOCASE', me.family_id)
      .map(m => ({ id: m.id, name: m.name, email: m.managed_by ? null : m.login, isAdmin: Boolean(m.is_admin), managedBy: m.managed_by }));
    // Kto co kupuje — tylko w tymczasowym trybie organizatora.
    const all = !this.god(me) ? [] : this.rows(`SELECT w.id AS wishId,w.title,w.tier,w.owner_id AS ownerId,r.member_id AS buyerId,r.purchased
      FROM reservations r JOIN wishes w ON w.id=r.wish_id JOIN members m ON m.id=w.owner_id WHERE m.family_id=? ORDER BY w.created_at`, me.family_id);
    const reservations = all.filter(r => r.ownerId !== me.id).map(r => ({ ...r, purchased: Boolean(r.purchased) }));
    const invite = this.one('SELECT invite FROM family WHERE id=?', me.family_id).invite;
    return { invite: `${origin}/#invite=${invite}`, members, reservations, locked: !this.god(me) };
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
        const reader = request.body?.getReader();
        const chunks = []; let size = 0;
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 16000) { await reader.cancel(); fail(413, 'Przesłany formularz jest za duży.'); }
            chunks.push(value);
          }
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        try { body = JSON.parse(new TextDecoder().decode(bytes) || '{}'); } catch { fail(400, 'Niepoprawny formularz. Odśwież stronę i spróbuj ponownie.'); }
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
      this.rateLimit(`login:${await digest(e)}`, 20, 900);
      const account = this.one('SELECT * FROM accounts WHERE email=?', e);
      const computed = await passwordHash(body.password, account?.salt || 'missing-user-timing-padding');
      if (!account || !constantEqual(computed, account.password_hash)) fail(401, 'Nieprawidłowy e-mail lub hasło.');
      return this.session(account);
    }
    // Rejestracja zakłada rodzinę (zakładający zostaje organizatorem), dołączenie wchodzi do rodziny z zaproszenia.
    // W obu przypadkach: nowe konto albo — gdy e-mail i hasło pasują do istniejącego — kolejna rodzina tego konta.
    if (method === 'POST' && (path === '/api/register' || path === '/api/join')) {
      this.rateLimit(`auth:${ipKey}`, 30, 900);
      const register = path === '/api/register';
      const name = line(body.name, 'Imię', 60, true), mail = email(body.email), pass = password(body.password);
      let family;
      if (register) {
        if (!this.canRegister()) fail(403, 'Zakładanie nowych rodzin jest tu wyłączone. Poproś bliskich o zaproszenie.');
        this.rateLimit(`register:${ipKey}`, 5, 3600);
        family = await this.newFamily(body.familyName);
      } else {
        family = this.one('SELECT * FROM family WHERE invite_hash=?', await inviteToken(body.inviteToken));
        if (!family) fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
      }
      const account = await this.credentials(mail, pass, 'Masz już konto z tym adresem — wpisz jego hasło albo zaloguj się.');
      let memberId;
      this.ctx.storage.transactionSync(() => {
        this.claim(account);
        if (register) this.insertFamily(family);
        else if (!this.one('SELECT id FROM family WHERE invite_hash=?', family.invite_hash)) fail(404, 'Zaproszenie wygasło. Poproś o nowy link.');
        const already = this.one('SELECT id FROM members WHERE family_id=? AND account_id=?', family.id, account.id);
        memberId = already ? already.id : this.addMembership(family.id, account.id, name, register);
      });
      return this.session(account, memberId);
    }
    if (method === 'GET' && /^\/api\/invitation\/[a-f0-9]{64}$/.test(path)) {
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
      const acct = this.one('SELECT * FROM accounts WHERE email=?', e);
      const pick = acct && this.pickMember(acct.id);
      const m = pick && this.one('SELECT * FROM members WHERE id=?', pick.id);
      if (m && mailOn(this.env)) {
        try {
        this.rateLimit(`forgot-to:${await digest(e)}`, 3, 86400);
        await sendMail(this.env, acct.email, {
          subject: 'Nowe hasło do listów do Mikołaja', heading: `Cześć, ${m.name}`,
          lines: ['Ktoś poprosił o nowe hasło do Twojego konta. Jeśli to Ty — kliknij poniżej i ustaw nowe.'],
          button: { label: 'Ustaw nowe hasło', url: `${this.base(url)}/#link=${await this.newLink(m)}` },
          foot: 'Link działa raz, przez 3 dni. Jeśli to nie Ty, po prostu zignoruj tę wiadomość.', base: this.base(url),
        });
        } catch (error) { if (!(error instanceof AppError)) throw error; }
      }
      return json({ ok: true });
    }
    // Link z maila: koniec przypomnień na ten adres (hasło i zaproszenia dalej dochodzą).
    if (method === 'POST' && path === '/api/mails/off') {
      if (typeof body.token === 'string' && /^[a-f0-9]{64}$/.test(body.token)) this.sql.exec('UPDATE accounts SET mails=0 WHERE mail_token=?', body.token);
      return json({ ok: true });
    }

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
      // Nowe hasło do istniejącego konta.
      if (!member.managed_by) {
        const salt = random(), pw = await passwordHash(pass, salt);
        let account;
        this.ctx.storage.transactionSync(() => {
          member = find();
          if (!member || member.managed_by || !member.account_id) fail(404, 'Ten link wygasł albo został już użyty.');
          this.sql.exec('UPDATE accounts SET salt=?,password_hash=? WHERE id=?', salt, pw, member.account_id);
          // Wszystkie sesje i linki konta — ze wszystkich rodzin.
          this.sql.exec('DELETE FROM links WHERE member_id IN (SELECT id FROM members WHERE account_id=?)', member.account_id);
          this.sql.exec('DELETE FROM sessions WHERE member_id IN (SELECT id FROM members WHERE account_id=?)', member.account_id);
          account = this.one('SELECT * FROM accounts WHERE id=?', member.account_id);
        });
        return this.session(account, member.id);
      }
      // Przejęcie listy: nowe konto albo podpięcie pod istniejące (wtedy hasło musi się zgadzać).
      const account = await this.credentials(email(body.email), pass, 'Ten adres ma już konto — wpisz jego hasło, a lista dołączy do Twojego konta.');
      this.ctx.storage.transactionSync(() => {
        member = find();
        if (!member || !member.managed_by) fail(404, 'Ten link wygasł albo został już użyty.');
        this.claim(account);
        if (this.one('SELECT id FROM members WHERE family_id=? AND account_id=?', member.family_id, account.id)) fail(409, 'To konto jest już w tej rodzinie. Poproś organizatora, żeby usunął jedną z list.');
        this.sql.exec('UPDATE members SET account_id=?,email=?,managed_by=NULL WHERE id=?', account.id, `acct:${member.id}`, member.id);
        this.sql.exec('DELETE FROM links WHERE member_id=?', member.id);
        this.sql.exec('DELETE FROM sessions WHERE member_id=?', member.id);
      });
      return this.session(account, member.id);
    }

    // ---------- z logowaniem ----------
    const token = request.headers.get('Cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
    const sessionHash = /^[a-f0-9]{64}$/.test(token) ? await digest(token) : '';
    const me = this.who(sessionHash);
    if (method === 'GET' && path === '/api/state') {
      // Sesja odnawia się przy użyciu — kto zagląda raz na kilka tygodni, nie musi pamiętać hasła.
      const renew = me && me.expires < now() + SESSION_AGE - 86400;
      if (renew) this.sql.exec('UPDATE sessions SET expires=? WHERE hash=?', now() + SESSION_AGE, sessionHash);
      return json(this.state(me), 200, renew ? { 'Set-Cookie': cookie(token) } : {});
    }
    if (method === 'POST' && path === '/api/logout') {
      this.sql.exec('DELETE FROM sessions WHERE hash=?', sessionHash);
      return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
    }
    if (!me) fail(401, 'Zaloguj się, aby zobaczyć rodzinne listy.');
    // Odpowiedź na zapis niesie świeży stan — aplikacja nie musi pytać o niego drugi raz.
    const done = (extra = {}, status = 200) => json({ ok: true, ...extra, state: this.state(this.who(sessionHash)) }, status);

    const member = id => this.one('SELECT * FROM members WHERE id=? AND family_id=?', id, me.family_id) || fail(404, 'Nie znaleziono tej osoby.');
    const god = this.god(me);
    const canEdit = m => m.id === me.id || m.managed_by === me.id || god;
    const adminOnly = () => { if (!me.is_admin) fail(403, 'To może zrobić tylko organizator rodziny.'); };

    // Kilka rodzin na jednym koncie: sesja wskazuje aktywną; przełączenie wyłącza tryb organizatora.
    const switchTo = memberId => {
      this.sql.exec('UPDATE sessions SET member_id=?,admin_until=0 WHERE hash=?', memberId, sessionHash);
      this.sql.exec('UPDATE accounts SET last_member=? WHERE id=?', memberId, me.account_id);
    };
    if (method === 'POST' && path === '/api/switch') {
      const target = typeof body.memberId === 'string' && this.one('SELECT id FROM members WHERE id=? AND account_id=?', body.memberId, me.account_id);
      if (!target) fail(404, 'Nie należysz do tej rodziny.');
      switchTo(target.id);
      return done();
    }
    if (method === 'POST' && path === '/api/families') {
      this.rateLimit(`register:${ipKey}`, 5, 3600);
      const family = await this.newFamily(body.familyName);
      const name = line(body.name ?? me.name, 'Imię', 60, true);
      this.ctx.storage.transactionSync(() => {
        this.insertFamily(family);
        switchTo(this.addMembership(family.id, me.account_id, name, true));
      });
      return done();
    }
    if (method === 'POST' && path === '/api/families/join') {
      this.rateLimit(`auth:${ipKey}`, 30, 900);
      const inviteHash = await inviteToken(body.inviteToken);
      const name = line(body.name ?? me.name, 'Imię', 60, true);
      let already = false;
      this.ctx.storage.transactionSync(() => {
        const family = this.one('SELECT id FROM family WHERE invite_hash=?', inviteHash);
        if (!family) fail(404, 'Zaproszenie jest nieprawidłowe lub wygasło.');
        const existing = this.one('SELECT id FROM members WHERE family_id=? AND account_id=?', family.id, me.account_id);
        already = Boolean(existing);
        switchTo(existing ? existing.id : this.addMembership(family.id, me.account_id, name, false));
      });
      return done({ already });
    }
    // Opuszczenie aktywnej rodziny. Nie dotyczy jedynej rodziny (to byłoby usunięcie konta)
    // ani organizatora — ten najpierw przekazuje rolę, żeby rodzina nie została bez opiekuna.
    if (method === 'POST' && path === '/api/leave') {
      let next;
      this.ctx.storage.transactionSync(() => {
        const self = this.one('SELECT * FROM members WHERE id=?', me.id);
        if (!self) fail(404, 'Nie należysz już do tej rodziny.');
        next = this.one('SELECT m.id,f.name FROM members m JOIN family f ON f.id=m.family_id WHERE m.account_id=? AND m.id<>? ORDER BY m.rowid LIMIT 1', me.account_id, me.id);
        if (!next) fail(409, 'To Twoja jedyna rodzina — nie możesz jej opuścić.');
        if (self.is_admin) fail(409, 'Jesteś organizatorem — najpierw przekaż tę rolę komuś innemu w zakładce Rodzina.');
        const heir = this.one('SELECT id FROM members WHERE family_id=? AND id<>? AND managed_by IS NULL ORDER BY is_admin DESC, rowid LIMIT 1', me.family_id, me.id);
        this.removeMember(self, heir?.id ?? null);
      });
      return done({ family: next.name });
    }

    if (method === 'GET' && path === '/api/admin') { adminOnly(); return json(this.admin(me, this.base(url))); }
    if (method === 'PATCH' && path === '/api/account') {
      if (typeof body.mails !== 'boolean') fail(400, 'Niepoprawne ustawienie.');
      this.sql.exec('UPDATE accounts SET mails=? WHERE id=?', body.mails ? 1 : 0, me.account_id);
      return done();
    }
    // Tryb organizatora: włączany ręcznie, tylko w tej sesji, wyłącza się sam po godzinie.
    if (method === 'PATCH' && path === '/api/session') {
      adminOnly();
      this.sql.exec('UPDATE sessions SET admin_until=? WHERE hash=?', body.adminMode === true ? now() + 3600 : 0, sessionHash);
      return done();
    }
    if (method === 'POST' && path === '/api/invite/email') {
      adminOnly();
      // Limit na konto (nie na rodzinę) i wspólny dzienny — żeby nikt nie rozsyłał stąd cudzych treści.
      this.rateLimit(`invite-mail:${me.account_id}`, 20, 86400);
      this.rateLimit('invite-mail:all', 60, 86400);
      const to = email(body.email);
      const family = this.one('SELECT name,invite FROM family WHERE id=?', me.family_id);
      await sendMail(this.env, to, {
        subject: 'Zaproszenie do rodzinnych listów do Mikołaja', heading: 'Zaproszenie',
        lines: [`${me.name} zaprasza Cię do rodziny ${family.name} — do wspólnych list do Mikołaja.`, 'Każdy pisze list i życzenia, a bliscy wybierają prezenty tak, żeby nikt nie kupił tego samego. Niespodzianka zostaje niespodzianką.'],
        // adres w linku wypełnia formularz dołączenia (zostaje we fragmencie — nie trafia do serwera)
        button: { label: 'Dołączam', url: `${this.base(url)}/#invite=${family.invite}&email=${encodeURIComponent(to)}` },
        foot: 'Jeśli nie znasz nadawcy, zignoruj tę wiadomość.', base: this.base(url),
      });
      return done();
    }
    if (method === 'PATCH' && path === '/api/family') {
      adminOnly();
      this.sql.exec('UPDATE family SET name=? WHERE id=?', line(body.name, 'Nazwa rodziny', 80, true), me.family_id);
      return done();
    }
    if (method === 'POST' && path === '/api/invite') {
      adminOnly();
      const invite = random();
      this.sql.exec('UPDATE family SET invite=?,invite_hash=? WHERE id=?', invite, await digest(invite), me.family_id);
      return done();
    }

    // osoby
    if (method === 'POST' && path === '/api/members') {
      // Każdy może dodać osobę, za którą wpisuje list — dziecko, babcię; prowadzi ją wtedy sam.
      const name = line(body.name, 'Imię', 60, true), id = crypto.randomUUID();
      if (this.one('SELECT COUNT(*) AS n FROM members WHERE family_id=?', me.family_id).n >= 100) fail(409, 'Osiągnięto limit członków rodziny.');
      // Osoba bez konta: adres zastępczy i puste hasło — nie da się na nią zalogować.
      this.sql.exec('INSERT INTO members(id,family_id,name,email,salt,password_hash,managed_by) VALUES(?,?,?,?,?,?,?)', id, me.family_id, name, `managed:${id}`, '', '', me.id);
      return done({ id }, 201);
    }
    const memberMatch = path.match(/^\/api\/members\/([^/]+)(\/letter|\/link)?$/);
    if (memberMatch) {
      const target = member(memberMatch[1]);
      if (memberMatch[2] === '/letter' && method === 'PATCH') {
        if (!canEdit(target)) fail(403, 'Możesz zmieniać tylko swój list i listy osób, które prowadzisz.');
        this.sql.exec('UPDATE members SET letter=? WHERE id=?', text(body.letter, 'List', 4000), target.id);
        return done();
      }
      if (memberMatch[2] === '/link' && method === 'POST') {
        if (!me.is_admin && target.managed_by !== me.id) fail(403, 'Brak uprawnień.');
        if (!target.managed_by) fail(403, 'Osoba z własnym kontem musi użyć odzyskiwania hasła przez e-mail.');
        return json({ url: `${this.base(url)}/#link=${await this.newLink(target)}` });
      }
      if (!memberMatch[2] && method === 'PATCH') {
        adminOnly();
        this.ctx.storage.transactionSync(() => {
        if (body.managedBy !== undefined) {
          if (!target.managed_by) fail(400, 'Ta osoba ma własne konto.');
          const manager = member(body.managedBy);
          if (manager.managed_by) fail(400, 'Listę może prowadzić tylko osoba z własnym kontem.');
          this.sql.exec('UPDATE members SET managed_by=? WHERE id=?', manager.id, target.id);
          this.sql.exec('DELETE FROM links WHERE member_id=?', target.id);
        }
        if (body.admin === true) {
          if (target.managed_by) fail(400, 'Organizator musi mieć własne konto.');
          this.sql.exec('UPDATE members SET is_admin=0 WHERE family_id=?', me.family_id);
          this.sql.exec('UPDATE members SET is_admin=1 WHERE id=?', target.id);
        }
        });
        return done();
      }
      if (!memberMatch[2] && method === 'DELETE') {
        if (target.id === me.id) fail(400, 'Nie możesz usunąć siebie.');
        if (!me.is_admin && target.managed_by !== me.id) fail(403, 'Brak uprawnień.');
        this.ctx.storage.transactionSync(() => this.removeMember(target, me.id));
        return done();
      }
    }

    // życzenia
    if (method === 'POST' && path === '/api/wishes') {
      const owner = member(body.ownerId || me.id);
      if (!canEdit(owner)) fail(403, 'Możesz dodawać życzenia tylko na swoją listę i listy osób, które prowadzisz.');
      const w = wishFields(body), id = crypto.randomUUID();
      if (this.one('SELECT COUNT(*) AS n FROM wishes WHERE owner_id=?', owner.id).n >= 200) fail(409, 'Lista może mieć najwyżej 200 życzeń.');
      this.sql.exec('INSERT INTO wishes(id,owner_id,title,note,url,tier,created_at) VALUES(?,?,?,?,?,?,?)', id, owner.id, w.title, w.note, w.url, w.tier, new Date().toISOString());
      return done({ id }, 201);
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
          return done();
        }
        if (method === 'DELETE') {
          // ?check=1: usuń tylko, jeśli nikt tego nie kupuje — inaczej aplikacja najpierw ostrzeże (bez zdradzania, kto)
          if (url.searchParams.get('check') === '1' && this.one('SELECT 1 AS x FROM reservations WHERE wish_id=?', w.id)) return json({ reserved: true });
          this.ctx.storage.transactionSync(() => {
            this.sql.exec('DELETE FROM reservations WHERE wish_id=?', w.id);
            this.sql.exec('DELETE FROM wishes WHERE id=?', w.id);
          });
          return done();
        }
      } else {
        if (w.owner_id === me.id) fail(403, 'Nie możesz kupować prezentów z własnej listy.');
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
          if (reservation && !god) fail(409, 'Ktoś już to kupuje. Wybierz inny prezent.');
          const snap = JSON.stringify({ title: w.title, note: w.note, url: w.url, tier: w.tier });
          // Odczyt i zapis bez await pomiędzy — atomowe w obrębie Durable Object.
          if (reservation) this.sql.exec('UPDATE reservations SET purchased=CASE WHEN member_id=? THEN purchased ELSE 0 END,member_id=?,snapshot=?,reserved_at=? WHERE wish_id=?', buyer.id, buyer.id, snap, now(), w.id);
          else this.sql.exec('INSERT INTO reservations(wish_id,member_id,purchased,snapshot,reserved_at) VALUES(?,?,0,?,?)', w.id, buyer.id, snap, now());
          return done();
        }
        if (!reservation || (reservation.member_id !== me.id && !god)) fail(403, 'Możesz zmieniać tylko prezenty, które kupujesz Ty.');
        if (method === 'DELETE') { this.sql.exec('DELETE FROM reservations WHERE wish_id=?', w.id); return done(); }
        if (method === 'PATCH') {
          if (typeof body.purchased !== 'boolean') fail(400, 'Niepoprawny status prezentu.');
          this.sql.exec('UPDATE reservations SET purchased=? WHERE wish_id=?', body.purchased ? 1 : 0, w.id);
          return done();
        }
      }
    }
    fail(404, 'Nie znaleziono tej strony.');
  }
}

const SEO = {
  '/robots.txt': origin => [`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`, 'text/plain; charset=utf-8'],
  '/sitemap.xml': origin => [`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>\n`, 'application/xml; charset=utf-8'],
};
// index.html z wbudowanym CSS — tekst maluje się bez czekania na osobny arkusz.
async function page(request, env, origin) {
  const read = async path => { const r = await env.ASSETS.fetch(new URL(path, request.url)); return r.ok ? r.text() : fail(500, 'Brak plików aplikacji.'); };
  const [html, css] = await Promise.all([read('/'), read('/app.css')]);
  // Nonce na odpowiedź — działa też skrypt, który Cloudflare potrafi wstrzyknąć, bez 'unsafe-inline'.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  let body = html.replaceAll('{{ORIGIN}}', origin).replaceAll('<script', `<script nonce="${nonce}"`)
    .replace('<link rel="stylesheet" href="/app.css">', () => `<style nonce="${nonce}">${css}</style>`);
  // Zalogowany nie powinien mignąć stroną startową, która leży gotowa w HTML.
  if (request.headers.get('Cookie')?.split(';').some(v => v.trim().startsWith(`${COOKIE}=`))) body = body.replace('<main id="app" class="pre">', '<main id="app" class="pre" hidden>');
  const csp = SECURITY['Content-Security-Policy'].replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`).replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`);
  return new Response(request.method === 'HEAD' ? null : body, { headers: { ...SECURITY, 'Content-Security-Policy': csp, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Jeden adres: gdy APP_URL jest ustawiony, inne domeny przenoszą na niego (fragment #invite=… przeglądarka zachowuje sama).
    const home = env.APP_URL ? new URL(env.APP_URL) : url;
    if (url.host !== home.host && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      return Response.redirect(`${home.origin}${url.pathname}${url.search}`, url.pathname.startsWith('/api/') ? 308 : 301);
    }
    if (url.pathname.startsWith('/api/')) return env.FAMILY.getByName('family-v1').fetch(request);
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Niedozwolona metoda.' }, 405);
    if (url.pathname === '/version.json') return json({ revision: env.DEPLOY_REVISION || 'manual' });
    try {
      if (url.pathname === '/') return await page(request, env, home.origin);
    } catch { return new Response('Nie udało się wczytać aplikacji.', { status: 500, headers: SECURITY }); }
    if (SEO[url.pathname]) {
      const [body, type] = SEO[url.pathname](home.origin);
      return new Response(body, { headers: { ...SECURITY, 'Content-Type': type, 'Cache-Control': 'no-cache' } });
    }
    // Pliki z public/ podaje Cloudflare (ETag, kompresja); tu dochodzą tylko nagłówki.
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 404) return new Response('Nie znaleziono strony.', { status: 404, headers: SECURITY });
    const response = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(SECURITY)) response.headers.set(name, value);
    // favicon.svg przełącza kolor własnym <style> (prefers-color-scheme) — skryptów i tak nie ma
    if (url.pathname.endsWith('.svg')) response.headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    // ikony i fonty leżą w pamięci przeglądarki rok (nowa wersja pliku = nowa nazwa); kod jest zawsze sprawdzany na nowo
    const lasting = /^(image|font)\//.test(response.headers.get('Content-Type') || '');
    response.headers.set('Cache-Control', lasting ? 'public, max-age=31536000, immutable' : 'no-cache');
    return response;
  },
  // Harmonogram: 3 grudnia — przypomnienie przed Wigilią; codziennie w południe — nowe życzenia.
  async scheduled(controller, env, ctx) {
    const store = env.FAMILY.getByName('family-v1');
    ctx.waitUntil(controller.cron === '0 9 3 12 *' ? store.remind() : store.digest());
  },
};
