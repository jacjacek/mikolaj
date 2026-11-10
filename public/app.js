/* Mikołaj — rodzinne listy do Mikołaja.
   Moduł ES bez zależności. Dane użytkowników trafiają do DOM wyłącznie
   przez textContent, .value lub setAttribute — nigdy przez innerHTML. */

const d = document;

// ---------- Stałe i formatowanie ----------

const LIMITS = Object.freeze({
  title: 160, note: 1500, url: 2000, letter: 4000,
  name: 60, family: 80, email: 254, passwordMin: 10, passwordMax: 256,
});

const FORMS = Object.freeze({
  wish: ['życzenie', 'życzenia', 'życzeń'],
  person: ['osoba', 'osoby', 'osób'],
  gift: ['prezent', 'prezenty', 'prezentów'],
  day: ['dzień', 'dni', 'dni'],
  char: ['znak', 'znaki', 'znaków'],
});

const UNEXPECTED = 'Serwer zwrócił nieoczekiwaną odpowiedź. Odśwież stronę albo spróbuj ponownie za chwilę.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_RE = /^[a-f0-9]{64}$/;

const fmtWhole = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 });
const fmtCents = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatPrice = n => (Number.isInteger(n) ? fmtWhole : fmtCents).format(n);

function plural(n, [one, few, many]) {
  if (n === 1) return one;
  const a = n % 10, b = n % 100;
  return a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}
const count = (n, forms) => `${n} ${plural(n, forms)}`;

const firstName = name => name.trim().split(/\s+/)[0] || name;
const initial = name => (Array.from(name.trim())[0] || '?').toLocaleUpperCase('pl-PL');
function toneFor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash % 4;
}
function snippet(text, max = 120) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}
function displayHost(href) {
  try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return href; }
}

function christmas(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), day = now.getDate();
  if (m === 11 && day === 24) return { kind: 'eve' };
  if (m === 11 && (day === 25 || day === 26)) return { kind: 'holiday' };
  const today = new Date(y, m, day);
  let eve = new Date(y, 11, 24);
  if (today > eve) eve = new Date(y + 1, 11, 24);
  return { kind: 'countdown', days: Math.round((eve - today) / 86400000) };
}
function greeting() {
  const hour = new Date().getHours();
  return hour >= 5 && hour < 18 ? 'Dzień dobry' : 'Dobry wieczór';
}

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- DOM ----------

let uidSeq = 0;
const uid = (prefix = 'id') => `${prefix}-${++uidSeq}`;
const $ = (sel, root = d) => root.querySelector(sel);
const mainEl = () => d.getElementById('main');

function h(tag, props, ...children) {
  const el = d.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'value') el.value = value;
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(name, cls = 'icon') {
  const svg = d.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = d.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', name === 'seal' ? '#brand-seal' : `#i-${name}`);
  svg.append(use);
  return svg;
}
function sealMark(cls) {
  const svg = icon('seal', cls);
  svg.setAttribute('viewBox', '0 0 32 32');
  return svg;
}
function art(name) {
  const tpl = d.getElementById(`art-${name}`);
  return tpl ? tpl.content.firstElementChild.cloneNode(true) : h('span');
}

function setBusy(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('is-busy', on);
  if (on) btn.setAttribute('aria-busy', 'true');
  else btn.removeAttribute('aria-busy');
}

function focusHeading() {
  const target = $('h1', mainEl()) || mainEl();
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

function restoreFocus(el) {
  if (el && el !== d.body && el.isConnected && typeof el.focus === 'function') { el.focus(); return; }
  const key = el?.dataset?.fkey;
  if (key) {
    const next = d.querySelector(`[data-fkey="${CSS.escape(key)}"]`);
    if (next) { next.focus(); return; }
  }
  focusHeading();
}

// ---------- API ----------

class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
}
const bad = () => new ApiError(UNEXPECTED);
const messageOf = err => (err instanceof ApiError ? err.message : 'Coś poszło nie tak. Spróbuj ponownie.');

function statusMessage(status) {
  if (status === 400) return 'Nie udało się — sprawdź wpisane dane.';
  if (status === 401) return 'Sesja wygasła. Zaloguj się ponownie.';
  if (status === 403) return 'Nie masz do tego uprawnień.';
  if (status === 404) return 'Nie znaleziono — mogło zostać usunięte.';
  if (status === 409) return 'Dane zmieniły się w międzyczasie. Odświeżamy widok.';
  if (status === 429) return 'Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.';
  if (status >= 500) return 'Serwer ma chwilowy kłopot. Spróbuj ponownie za chwilę.';
  return 'Coś poszło nie tak. Spróbuj ponownie.';
}

let inflight = 0;

async function api(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  const init = {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal: ctrl.signal,
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  inflight++;
  try {
    let res;
    try { res = await fetch(path, init); }
    catch {
      throw new ApiError(ctrl.signal.aborted
        ? 'Serwer odpowiada zbyt długo. Spróbuj ponownie za chwilę.'
        : 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.');
    }
    let data = null;
    try { const raw = await res.text(); data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!res.ok) {
      const msg = isObj(data) && isStr(data.error) && data.error.trim() ? data.error.trim().slice(0, 400) : statusMessage(res.status);
      if (res.status === 401 && state.me) queueMicrotask(() => sessionExpired());
      throw new ApiError(msg, res.status);
    }
    if (!isObj(data)) throw new ApiError(UNEXPECTED, res.status);
    return data;
  } finally {
    clearTimeout(timer);
    inflight--;
  }
}

// ---------- Walidacja odpowiedzi ----------

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string';
const isId = v => (isStr(v) && v.length > 0 && v.length <= 128) || Number.isSafeInteger(v);
const str = v => (isStr(v) ? v : '');

function toPrice(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : (isStr(v) ? Number(v.replace(',', '.')) : NaN);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function normSession(data) {
  if (!isObj(data)) throw bad();
  if (data.user === null) return null;
  const { user, family, members } = data;
  if (!isObj(user) || !isId(user.id) || !isStr(user.name) || !isObj(family) || !isId(family.id) || !isStr(family.name) || !Array.isArray(members)) throw bad();
  return {
    user: { id: String(user.id), name: user.name.trim() || 'Ty', email: str(user.email), isAdmin: user.isAdmin === true },
    family: { id: String(family.id), name: family.name.trim() || 'Rodzina' },
    members: members
      .filter(m => isObj(m) && isId(m.id) && isStr(m.name))
      .map(m => ({
        id: String(m.id),
        name: m.name.trim() || 'Bez imienia',
        letter: str(m.letter),
        wishCount: Number.isSafeInteger(m.wishCount) && m.wishCount >= 0 ? m.wishCount : 0,
      })),
  };
}

function normWish(w, own) {
  if (!isObj(w) || !isId(w.id) || !isStr(w.title)) return null;
  const wish = {
    id: String(w.id),
    ownerId: isId(w.ownerId) ? String(w.ownerId) : '',
    title: w.title.trim() || 'Bez nazwy',
    note: str(w.note).trim(),
    url: safeHttpUrl(w.url),
    price: toPrice(w.price),
  };
  // Na własnej liście nigdy nie przenosimy pól rezerwacji — nawet gdyby serwer je przysłał.
  if (!own) {
    wish.reservedByMe = w.reservedByMe === true;
    wish.reserved = w.reserved === true || wish.reservedByMe;
    wish.purchased = w.purchased === true && wish.reserved;
    if (wish.reservedByMe) wish.changedSinceReservation = w.changedSinceReservation === true;
  }
  return wish;
}

function normMemberWishes(data, myId) {
  if (!isObj(data) || !isObj(data.member) || !isId(data.member.id) || !isStr(data.member.name) || !Array.isArray(data.wishes)) throw bad();
  const memberId = String(data.member.id);
  const own = memberId === myId;
  return {
    own,
    member: { id: memberId, name: data.member.name.trim() || 'Bez imienia', letter: str(data.member.letter) },
    wishes: data.wishes
      .map(w => normWish(w, own || (isObj(w) && isId(w.ownerId) && String(w.ownerId) === myId)))
      .filter(Boolean),
  };
}

function normReservations(data) {
  if (!isObj(data) || !Array.isArray(data.wishes)) throw bad();
  return data.wishes
    .filter(w => isObj(w) && isId(w.id) && isStr(w.title))
    .map(w => ({
      id: String(w.id),
      ownerId: isId(w.ownerId) ? String(w.ownerId) : '',
      ownerName: isStr(w.ownerName) && w.ownerName.trim() ? w.ownerName.trim() : 'Ktoś z rodziny',
      title: w.title.trim() || 'Bez nazwy',
      note: str(w.note).trim(),
      url: safeHttpUrl(w.url),
      price: toPrice(w.price),
      purchased: w.purchased === true,
      changedSinceReservation: w.changedSinceReservation === true,
    }));
}

function normInviteUrl(data) {
  const url = isObj(data) ? safeHttpUrl(data.url) : null;
  if (!url) throw bad();
  return url;
}

// ---------- Stan ----------

const freshAuth = () => ({ mode: 'login', invitation: { status: 'idle', familyName: '' }, notice: null, brokenLink: false });

const state = {
  me: null,
  tokens: { setup: null, invite: null },
  auth: freshAuth(),
  pendingLink: null,
  inviteUrl: null,
  editingLetter: false,
  letterDirty: false,
  justChanged: null,
  lastVisibleRefresh: 0,
  booting: true,
  appHash: '',
};
let letterNode = null;

// ---------- Fragment URL: #setup= / #invite= ----------

function readLinkFragment() {
  const raw = location.hash.slice(1);
  if (!raw || raw.startsWith('/')) return null;
  const params = new URLSearchParams(raw);
  const invite = params.get('invite');
  if (invite !== null) {
    const token = invite.trim().toLowerCase();
    return { kind: 'invite', token: INVITE_RE.test(token) ? token : null };
  }
  const setup = params.get('setup');
  if (setup !== null) {
    const token = setup.trim();
    return { kind: 'setup', token: /^\S{1,512}$/.test(token) ? token : null };
  }
  return null;
}

function applyLink(link) {
  state.tokens = { setup: null, invite: null };
  state.auth = freshAuth();
  if (!link) return;
  if (!link.token) { state.auth.brokenLink = true; return; }
  state.tokens[link.kind] = link.token;
  state.auth.mode = link.kind === 'invite' ? 'join' : 'create';
}

function clearFragment() {
  history.replaceState(null, '', location.pathname + location.search);
}

// ---------- Powiadomienia ----------

function toast(message, { tone = 'info' } = {}) {
  const region = d.getElementById(tone === 'error' ? 'toast-alert' : 'toast-status');
  if (!region) return;
  const close = h('button', { type: 'button', class: 'icon-btn toast__close', 'aria-label': 'Zamknij powiadomienie' }, icon('x', 'icon icon--sm'));
  const el = h('div', { class: `toast toast--${tone}` },
    icon(tone === 'error' ? 'alert' : tone === 'success' ? 'check' : 'info'),
    h('p', { class: 'toast__text', text: message }),
    close);
  let timer = 0;
  const remove = () => {
    clearTimeout(timer);
    if (!el.isConnected) return;
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), reduceMotion() ? 0 : 200);
  };
  const arm = ms => { clearTimeout(timer); timer = setTimeout(remove, ms); };
  close.addEventListener('click', remove);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => arm(2500));
  el.addEventListener('focusin', () => clearTimeout(timer));
  region.append(el);
  while (region.children.length > 3) region.firstElementChild.remove();
  arm(tone === 'error' ? 9000 : 4800);
}

// ---------- Okna dialogowe ----------

function openDialog({ title, body, initialFocus, size }) {
  const opener = d.activeElement;
  const titleId = uid('dlg');
  const closeBtn = h('button', { type: 'button', class: 'icon-btn dialog__close', 'aria-label': 'Zamknij okno' }, icon('x'));
  const dlg = h('dialog', { class: `dialog${size ? ` dialog--${size}` : ''}`, 'aria-labelledby': titleId },
    h('div', { class: 'dialog__head' }, h('h2', { class: 'dialog__title', id: titleId, text: title }), closeBtn),
    body);
  let busy = false;
  const ctl = {
    el: dlg,
    close() { if (dlg.open) dlg.close(); },
    setBusy(on) { busy = on; closeBtn.disabled = on; },
  };
  dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  closeBtn.addEventListener('click', () => { if (!busy) ctl.close(); });
  dlg.addEventListener('close', () => { dlg.remove(); restoreFocus(opener); });
  d.body.append(dlg);
  dlg.showModal();
  const target = initialFocus?.() || dlg.querySelector('input, textarea, button:not(.dialog__close)');
  target?.focus();
  return ctl;
}

function closeAllDialogs() {
  for (const dlg of d.querySelectorAll('dialog[open]')) dlg.close();
}

function formAlert() {
  const el = h('div', { class: 'form-alert', role: 'alert' });
  return {
    el,
    show(msg) { el.replaceChildren(h('div', { class: 'callout callout--error' }, icon('alert'), h('p', { text: msg }))); },
    clear() { el.replaceChildren(); },
  };
}

function confirmAction({ title, message, confirmLabel, tone = 'danger', action }) {
  const alert = formAlert();
  const cancel = h('button', { type: 'button', class: 'btn btn--secondary' }, 'Anuluj');
  const ok = h('button', { type: 'button', class: `btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}` }, confirmLabel);
  const body = h('div', { class: 'dialog__body' },
    h('p', { class: 'dialog__text', text: message }),
    alert.el,
    h('div', { class: 'dialog__actions' }, cancel, ok));
  const dlg = openDialog({ title, body, size: 'sm', initialFocus: () => cancel });
  cancel.addEventListener('click', () => dlg.close());
  ok.addEventListener('click', async () => {
    if (ok.disabled) return;
    alert.clear();
    dlg.setBusy(true); setBusy(ok, true); cancel.disabled = true;
    try {
      await action();
      dlg.setBusy(false);
      dlg.close();
    } catch (err) {
      if (err?.status === 401) return;
      dlg.setBusy(false); setBusy(ok, false); cancel.disabled = false;
      alert.show(messageOf(err));
      ok.focus();
    }
  });
}

// ---------- Pola formularzy ----------

function field({ label, name, type = 'text', multiline = false, rows = 4, value = '', hint, optional = false, required = false, maxlength, autocomplete, inputmode, placeholder, spellcheck, autocapitalize, trailing }) {
  const id = uid('f');
  const hintId = hint ? `${id}-hint` : null;
  const errId = `${id}-err`;
  const control = h(multiline ? 'textarea' : 'input', {
    id, name,
    class: 'input',
    type: multiline ? null : type,
    rows: multiline ? rows : null,
    required,
    maxlength, autocomplete, inputmode, placeholder, autocapitalize,
    spellcheck: spellcheck === false ? 'false' : null,
    'aria-describedby': [hintId, errId].filter(Boolean).join(' '),
  });
  control.value = value ?? '';
  const hintEl = hint ? h('p', { id: hintId, class: 'field__hint', text: hint }) : null;
  const err = h('p', { id: errId, class: 'field__error', hidden: true });
  const wrap = h('div', { class: 'field' },
    h('label', { class: 'field__label', for: id }, label, optional ? h('span', { class: 'field__optional', text: 'opcjonalnie' }) : null),
    trailing ? h('div', { class: 'field__row' }, control, trailing) : control,
    hintEl,
    err);
  return {
    wrap, control, hintEl,
    get value() { return control.value; },
    setError(msg) {
      err.replaceChildren(...(msg ? [icon('alert', 'icon icon--sm'), h('span', { text: msg })] : []));
      err.hidden = !msg;
      if (msg) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    },
  };
}

function passwordField({ label, autocomplete, isNew = false }) {
  const toggle = h('button', { type: 'button', class: 'icon-btn field__toggle', 'aria-label': 'Pokaż hasło', 'aria-pressed': 'false' }, icon('eye'));
  const f = field({
    label, name: 'password', type: 'password', autocomplete, required: true,
    maxlength: LIMITS.passwordMax, spellcheck: false, autocapitalize: 'none', trailing: toggle,
    hint: isNew ? `Co najmniej ${LIMITS.passwordMin} znaków. Najlepiej całe zdanie, którego nie używasz nigdzie indziej.` : null,
  });
  toggle.addEventListener('click', () => {
    const show = f.control.type === 'password';
    f.control.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.replaceChildren(icon(show ? 'eye-off' : 'eye'));
  });
  if (isNew && f.hintEl) {
    const base = f.hintEl.textContent;
    f.control.addEventListener('input', () => {
      const n = f.control.value.length;
      const ok = n >= LIMITS.passwordMin;
      f.hintEl.classList.toggle('is-ok', ok);
      f.hintEl.textContent = n === 0 ? base : ok
        ? 'Długość w porządku. Zapisz hasło w bezpiecznym miejscu.'
        : `Jeszcze ${count(LIMITS.passwordMin - n, FORMS.char)} do minimum.`;
    });
  }
  return f;
}

function bindSubmit({ form, button, alert, fields, validate, run, onBusy }) {
  let busy = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    alert.clear();
    const values = {};
    for (const [key, f] of Object.entries(fields)) values[key] = f.value;
    const problems = validate(values) || {};
    let first = null;
    for (const [key, f] of Object.entries(fields)) {
      const msg = problems[key] || '';
      f.setError(msg);
      if (msg && !first) first = f;
    }
    if (first) { first.control.focus(); return; }
    busy = true; setBusy(button, true); onBusy?.(true);
    try {
      await run(values);
    } catch (err) {
      if (err?.status === 401 && state.me) return;
      alert.show(messageOf(err));
    } finally {
      busy = false;
      if (button.isConnected) { setBusy(button, false); onBusy?.(false); }
    }
  });
}

const checkEmail = v => {
  const t = v.trim();
  if (!t) return 'Wpisz adres e-mail.';
  if (t.length > LIMITS.email || !EMAIL_RE.test(t)) return 'To nie wygląda na adres e-mail — sprawdź znak @ i domenę.';
  return '';
};
const checkName = (v, empty) => {
  const t = v.trim();
  if (!t) return empty;
  if (t.length > LIMITS.name) return `Maksymalnie ${LIMITS.name} znaków.`;
  return '';
};
const checkNewPassword = v => {
  if (!v) return 'Ustal hasło.';
  if (v.length < LIMITS.passwordMin) return `Hasło musi mieć co najmniej ${LIMITS.passwordMin} znaków — brakuje jeszcze ${LIMITS.passwordMin - v.length}.`;
  if (v.length > LIMITS.passwordMax) return `Hasło może mieć najwyżej ${LIMITS.passwordMax} znaków.`;
  return '';
};

function parseUrlInput(raw) {
  const t = raw.trim();
  if (!t) return { value: '' };
  if (/\s/.test(t)) return { error: 'Link nie może zawierać spacji.' };
  if (t.length > LIMITS.url) return { error: `Link jest za długi (maks. ${LIMITS.url} znaków).` };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(javascript|data|mailto|file|about):/i.test(t);
  const safe = safeHttpUrl(hasScheme ? t : `https://${t}`);
  if (!safe || !new URL(safe).hostname.includes('.')) return { error: 'Podaj adres strony zaczynający się od https:// lub http://.' };
  return { value: safe };
}

function parsePriceInput(raw) {
  const t = raw.replace(/[\s ]/g, '').replace(/(zł|zl|pln)$/i, '').replace(',', '.');
  if (!t) return { value: null };
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return { error: 'Podaj kwotę w złotych, np. 149 albo 149,99.' };
  const n = Number(t);
  if (n > 1000000) return { error: 'Maksymalnie 1 000 000 zł.' };
  return { value: Math.round(n * 100) / 100 };
}
const priceInputValue = n => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));

// ---------- Ekran powitalny ----------

function renderWelcome() {
  showShell(false);
  d.title = 'Mikołaj — rodzinne listy do Mikołaja';
  mainEl().replaceChildren(viewWelcome());
}

function viewWelcome() {
  const card = h('div', { class: 'auth-card paper', id: 'auth-card' });
  renderAuthCard(card);
  const fact = (name, text) => h('li', null, icon(name), h('span', { text }));
  const step = (n, artName, title, text) => h('li', { class: 'step' },
    art(artName),
    h('div', null,
      h('p', { class: 'step__num', 'aria-hidden': 'true', text: `0${n}` }),
      h('h3', { class: 'step__title', text: title }),
      h('p', { class: 'step__text', text })));

  return h('div', { class: 'welcome' },
    h('section', { class: 'welcome__hero container' },
      h('div', { class: 'welcome__intro' },
        h('div', { class: 'welcome__art' }, art('hero')),
        h('p', { class: 'eyebrow', text: 'Prywatne listy do Mikołaja' }),
        h('h1', { class: 'display', tabindex: '-1' }, 'Napisz list. ', h('em', { text: 'Rodzina' }), ' zadba o resztę.'),
        h('p', { class: 'lede', text: 'Każdy pisze swój list i dodaje życzenia. Bliscy po cichu rezerwują prezenty — bez dublowania zakupów i bez psucia niespodzianek.' }),
        h('ul', { class: 'facts', role: 'list' },
          fact('lock', 'Dostęp mają tylko osoby zaproszone do Twojej rodziny.'),
          fact('gift', 'Jeden prezent — jedna rezerwacja. Nikt nie kupi tego samego.'),
          fact('eye-off', 'Na własnej liście nie widzisz, co już ktoś szykuje.'))),
      h('div', { class: 'welcome__panel' }, card)),
    h('section', { class: 'how container', 'aria-labelledby': 'how-title' },
      h('h2', { class: 'section-title how__title', id: 'how-title', text: 'Jak to działa' }),
      h('ol', { class: 'how__steps', role: 'list' },
        step(1, 'step-letter', 'Napisz list', 'Kilka słów o tym, co lubisz, i lista życzeń z notatką, linkiem i orientacyjną ceną.'),
        step(2, 'step-gift', 'Rodzina rezerwuje', 'Bliscy widzą Twoją listę i rezerwują pojedyncze prezenty. Raz zarezerwowanego nikt już nie weźmie.'),
        step(3, 'step-seal', 'Niespodzianka zostaje', 'Ty nie widzisz rezerwacji, liczników ani tego, kto co kupił. Zobaczysz wszystko pod choinką.'))),
    h('footer', { class: 'site-foot container' },
      h('span', { text: 'Mikołaj · prywatne rodzinne listy życzeń' }),
      h('span', { text: 'E-mail służy tylko do logowania. Nie wysyłamy żadnych wiadomości.' })));
}

function rerenderAuthCard() {
  const card = d.getElementById('auth-card');
  if (card && !state.me) renderAuthCard(card);
}

function renderAuthCard(card) {
  const { auth, tokens } = state;
  const parts = [];
  if (auth.notice) parts.push(h('div', { class: 'callout callout--info', role: 'status' }, icon('info'), h('p', { text: auth.notice })));
  if (auth.brokenLink) {
    parts.push(h('div', { class: 'callout callout--error' }, icon('alert'),
      h('p', { text: 'Ten link jest niekompletny albo uszkodzony. Skopiuj go jeszcze raz w całości lub poproś o nowy.' })));
  }

  const onMode = mode => {
    state.auth.mode = mode;
    state.auth.notice = null;
    renderAuthCard(card);
    $('.segmented__btn[aria-pressed="true"]', card)?.focus();
  };

  if (tokens.invite) {
    const inv = auth.invitation;
    if (inv.status === 'loading' || inv.status === 'idle') {
      parts.push(h('div', { class: 'auth-loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: 'Sprawdzamy zaproszenie…' })));
    } else if (inv.status === 'invalid') {
      parts.push(
        h('div', { class: 'callout callout--error' }, icon('alert'),
          h('div', { class: 'callout__body' },
            h('p', { class: 'callout__title', text: 'To zaproszenie już nie działa.' }),
            h('p', { text: 'Link mógł zostać zmieniony. Poproś osobę, która prowadzi Waszą rodzinę w Mikołaju, o aktualny link. Jeśli masz już konto — po prostu się zaloguj.' }))),
        authHead('Zaloguj się', null),
        loginForm());
    } else {
      if (inv.status === 'error') {
        const retry = h('button', { type: 'button', class: 'btn btn--secondary btn--sm' }, icon('refresh'), 'Sprawdź ponownie');
        retry.addEventListener('click', () => checkInvitation());
        parts.push(h('div', { class: 'callout callout--error' }, icon('alert'),
          h('div', { class: 'callout__body' }, h('p', { text: `Nie udało się sprawdzić zaproszenia. ${inv.message || ''}`.trim() }), retry)));
      }
      parts.push(segmented([{ value: 'join', label: 'Dołącz do rodziny' }, { value: 'login', label: 'Mam już konto' }], auth.mode, onMode));
      if (auth.mode === 'join') {
        parts.push(
          h('div', { class: 'auth-card__head' },
            h('p', { class: 'eyebrow', text: 'Zaproszenie' }),
            inv.familyName
              ? h('h2', { class: 'auth-card__title' }, 'Dołącz do rodziny ', h('span', { class: 'auth-card__family', text: `„${inv.familyName}”` }))
              : h('h2', { class: 'auth-card__title', text: 'Dołącz do rodziny' }),
            h('p', { class: 'auth-card__text', text: 'Załóż konto, napisz swój list i zobacz listy bliskich.' })),
          joinForm());
      } else {
        parts.push(authHead('Zaloguj się', 'Masz już konto w tej rodzinie? Zaloguj się tym samym adresem e-mail.'), loginForm());
      }
    }
  } else if (tokens.setup) {
    parts.push(segmented([{ value: 'create', label: 'Załóż rodzinę' }, { value: 'login', label: 'Mam już konto' }], auth.mode, onMode));
    if (auth.mode === 'create') {
      parts.push(authHead('Załóż rodzinę', 'Ten prywatny link pozwala utworzyć rodzinę. Będziesz nią zarządzać i dostaniesz link zaproszenia dla bliskich.'), createForm());
    } else {
      parts.push(authHead('Zaloguj się', null), loginForm());
    }
  } else {
    parts.push(authHead('Zaloguj się', 'Witaj z powrotem. Twoje listy czekają.'), loginForm());
    parts.push(h('div', { class: 'auth-card__foot' },
      h('strong', { text: 'Nie masz jeszcze konta?' }),
      h('p', { text: 'Konto zakłada się wyłącznie z prywatnego linku zaproszenia. Poproś o niego osobę, która prowadzi Waszą rodzinę w Mikołaju — wystarczy go otworzyć na tym urządzeniu.' })));
  }
  card.replaceChildren(...parts);
}

function authHead(title, text) {
  return h('div', { class: 'auth-card__head' },
    h('h2', { class: 'auth-card__title', text: title }),
    text ? h('p', { class: 'auth-card__text', text }) : null);
}

function segmented(options, current, onChange) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': 'Wybierz formularz' },
    options.map(o => h('button', {
      type: 'button',
      class: 'segmented__btn',
      'aria-pressed': String(o.value === current),
      onclick: () => { if (o.value !== current) onChange(o.value); },
    }, o.label)));
}

function emailNote() {
  return h('p', { class: 'email-note' }, icon('info', 'icon icon--sm'),
    h('span', { text: 'E-mail to tylko login — nie wysyłamy wiadomości i nie ma jeszcze resetu hasła. Zapisz hasło w menedżerze haseł.' }));
}

function emailField() {
  return field({ label: 'E-mail', name: 'email', type: 'email', autocomplete: 'username', required: true, maxlength: LIMITS.email, inputmode: 'email', spellcheck: false, autocapitalize: 'none' });
}

function authForm({ fields, submitLabel, validate, submit, registered }) {
  const alert = formAlert();
  const button = h('button', { type: 'submit', class: 'btn btn--primary btn--block' }, submitLabel);
  const form = h('form', { class: 'form', novalidate: true },
    Object.values(fields).map(f => f.wrap), alert.el, button, emailNote());
  bindSubmit({
    form, button, alert, fields, validate,
    run: async values => {
      const me = normSession(await submit(values));
      if (!me) throw bad();
      onAuthenticated(me, registered);
    },
  });
  return form;
}

function loginForm() {
  return authForm({
    fields: { email: emailField(), password: passwordField({ label: 'Hasło', autocomplete: 'current-password' }) },
    submitLabel: 'Zaloguj się',
    validate: v => ({ email: checkEmail(v.email), password: v.password ? '' : 'Wpisz hasło.' }),
    submit: v => api('POST', '/api/login', { email: v.email.trim(), password: v.password }),
    registered: false,
  });
}

function createForm() {
  return authForm({
    fields: {
      familyName: field({ label: 'Nazwa rodziny', name: 'family', required: true, maxlength: LIMITS.family, placeholder: 'np. Kowalscy', autocomplete: 'off', hint: 'Zobaczą ją wszyscy zaproszeni.' }),
      name: field({ label: 'Twoje imię', name: 'name', required: true, maxlength: LIMITS.name, autocomplete: 'given-name', placeholder: 'np. Ania' }),
      email: emailField(),
      password: passwordField({ label: 'Hasło', autocomplete: 'new-password', isNew: true }),
    },
    submitLabel: 'Załóż rodzinę',
    validate: v => ({
      familyName: !v.familyName.trim() ? 'Nadaj rodzinie nazwę.' : v.familyName.trim().length > LIMITS.family ? `Maksymalnie ${LIMITS.family} znaków.` : '',
      name: checkName(v.name, 'Wpisz swoje imię — tak zobaczą Cię bliscy.'),
      email: checkEmail(v.email),
      password: checkNewPassword(v.password),
    }),
    submit: v => api('POST', '/api/create', { setupToken: state.tokens.setup, familyName: v.familyName.trim(), name: v.name.trim(), email: v.email.trim(), password: v.password }),
    registered: true,
  });
}

function joinForm() {
  return authForm({
    fields: {
      name: field({ label: 'Twoje imię', name: 'name', required: true, maxlength: LIMITS.name, autocomplete: 'given-name', placeholder: 'np. Ania', hint: 'Tak podpiszesz swój list.' }),
      email: emailField(),
      password: passwordField({ label: 'Hasło', autocomplete: 'new-password', isNew: true }),
    },
    submitLabel: 'Dołącz do rodziny',
    validate: v => ({
      name: checkName(v.name, 'Wpisz swoje imię — tak zobaczą Cię bliscy.'),
      email: checkEmail(v.email),
      password: checkNewPassword(v.password),
    }),
    submit: v => api('POST', '/api/join', { inviteToken: state.tokens.invite, name: v.name.trim(), email: v.email.trim(), password: v.password }),
    registered: true,
  });
}

async function checkInvitation() {
  const token = state.tokens.invite;
  if (!token) return;
  state.auth.invitation = { status: 'loading', familyName: '' };
  rerenderAuthCard();
  let next;
  try {
    const data = await api('GET', `/api/invitation/${encodeURIComponent(token)}`);
    const familyName = isStr(data.familyName) ? data.familyName.trim() : '';
    if (!familyName) throw bad();
    next = { status: 'ok', familyName };
  } catch (err) {
    next = err.status === 404 || err.status === 410
      ? { status: 'invalid', familyName: '' }
      : { status: 'error', familyName: '', message: messageOf(err) };
  }
  if (token !== state.tokens.invite || state.me) return;
  state.auth.invitation = next;
  if (next.status === 'invalid') state.auth.mode = 'login';
  rerenderAuthCard();
}

function onAuthenticated(me, registered, { silent = false } = {}) {
  state.me = me;
  state.tokens = { setup: null, invite: null };
  state.auth = freshAuth();
  state.pendingLink = null;
  clearFragment();
  state.appHash = '';
  renderApp({ initial: silent });
  if (silent) return;
  toast(registered
    ? `Witaj w rodzinie „${me.family.name}”! Zacznij od swojego listu.`
    : `Witaj ponownie, ${firstName(me.user.name)}.`, { tone: 'success' });
}

function signedOut(notice, link = null) {
  state.me = null;
  state.inviteUrl = null;
  state.editingLetter = false;
  state.letterDirty = false;
  state.pendingLink = null;
  letterNode = null;
  closeAllDialogs();
  applyLink(link);
  state.auth.notice = notice;
  if (link?.token) history.replaceState(null, '', `${location.pathname}${location.search}#${link.kind}=${encodeURIComponent(link.token)}`);
  else clearFragment();
  renderWelcome();
  if (state.tokens.invite) checkInvitation();
  focusHeading();
}

function sessionExpired() {
  if (!state.me) return;
  signedOut('Sesja wygasła. Zaloguj się ponownie.');
}

async function logout(btn, link = null) {
  setBusy(btn, true);
  try {
    await api('POST', '/api/logout', {});
  } catch (err) {
    if (err.status !== 401) {
      toast(messageOf(err), { tone: 'error' });
      if (btn.isConnected) setBusy(btn, false);
      return;
    }
  }
  setBusy(btn, false);
  signedOut(link ? null : 'Wylogowano. Do zobaczenia!', link);
}

// ---------- Powłoka zalogowanej aplikacji ----------

function showShell(on) {
  d.getElementById('topbar').hidden = !on;
  d.body.classList.toggle('is-authed', on);
  if (!on) d.getElementById('notice').replaceChildren();
}

function renderShell() {
  if (!state.me) return;
  const { user, family } = state.me;
  showShell(true);
  d.getElementById('brand-family').textContent = family.name;
  d.getElementById('session-name').textContent = user.name;
  const avatar = d.getElementById('session-avatar');
  avatar.textContent = initial(user.name);
  avatar.className = `avatar tone-${toneFor(user.id)}`;
  const logoutBtn = d.getElementById('logout-btn');
  logoutBtn.setAttribute('aria-label', `Wyloguj się (${user.name})`);
  d.querySelector('[data-nav="invite"]').hidden = !user.isAdmin;
  renderPendingNotice();
}

function updateNav(routeName) {
  for (const a of d.querySelectorAll('[data-nav]')) {
    const nav = a.dataset.nav;
    if (nav === routeName) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
    a.classList.toggle('is-active', routeName === 'member' && nav === 'home');
  }
}

function renderPendingNotice() {
  const slot = d.getElementById('notice');
  const link = state.pendingLink;
  if (!link || !state.me) { slot.replaceChildren(); return; }
  const what = link.kind === 'invite' ? 'link zaproszenia do rodziny' : 'link do założenia nowej rodziny';
  const leave = h('button', { type: 'button', class: 'btn btn--ink btn--sm' }, icon('logout'), 'Wyloguj się i użyj linku');
  const stay = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Zignoruj link');
  leave.addEventListener('click', () => logout(leave, link));
  stay.addEventListener('click', () => { state.pendingLink = null; renderPendingNotice(); focusHeading(); });
  slot.replaceChildren(h('div', { class: 'container' },
    h('div', { class: 'banner', role: 'region', 'aria-label': 'Otwarty link' },
      icon('link'),
      h('p', { class: 'banner__text', text: `Otwarto ${what}, ale masz już otwartą sesję jako ${state.me.user.name} (${state.me.family.name}). Aby go użyć, najpierw się wyloguj.` }),
      h('div', { class: 'banner__actions' }, leave, stay))));
}

function renderApp({ initial = true } = {}) {
  renderShell();
  renderRoute({ initial });
}

// ---------- Routing (#/…) ----------

function parseRoute() {
  const hash = location.hash;
  if (!hash.startsWith('#/')) return { name: 'home' };
  const [seg, arg] = hash.slice(2).split('/');
  switch (seg) {
    case '': return { name: 'home' };
    case 'moja-lista': return { name: 'mine' };
    case 'rezerwacje': return { name: 'reservations' };
    case 'zaproszenie': return { name: 'invite' };
    case 'osoba': {
      if (!arg) return { name: 'home' };
      try { return { name: 'member', id: decodeURIComponent(arg) }; } catch { return { name: 'notfound' }; }
    }
    default: return { name: 'notfound' };
  }
}

const ROUTES = {
  home: { title: () => 'Rodzina', render: () => viewHome() },
  mine: {
    title: () => 'Mój list',
    load: async () => normMemberWishes(await api('GET', `/api/members/${encodeURIComponent(state.me.user.id)}/wishes`), state.me.user.id),
    render: data => viewMine(data),
  },
  member: {
    title: data => data.member.name,
    load: async route => normMemberWishes(await api('GET', `/api/members/${encodeURIComponent(route.id)}/wishes`), state.me.user.id),
    render: data => viewMember(data),
  },
  reservations: {
    title: () => 'Moje rezerwacje',
    load: async () => normReservations(await api('GET', '/api/reservations')),
    render: data => viewReservations(data),
  },
  invite: { title: () => 'Zaproś rodzinę', render: () => viewInvite() },
  notfound: { title: () => 'Nie znaleziono', render: () => viewNotFound() },
};

async function refreshMe() {
  const me = normSession(await api('GET', '/api/me'));
  if (!me) {
    sessionExpired();
    throw new ApiError('Sesja wygasła. Zaloguj się ponownie.', 401);
  }
  if (!state.me) return me;
  state.me = me;
  renderShell();
  return me;
}

let routeSeq = 0;

async function renderRoute({ quiet = false, silent = false, initial = false } = {}) {
  if (!state.me) return;
  const seq = ++routeSeq;
  let route = parseRoute();
  if (route.name === 'member' && route.id === state.me.user.id) {
    history.replaceState(null, '', '#/moja-lista');
    route = { name: 'mine' };
  }
  if (!quiet) {
    state.editingLetter = false;
    state.letterDirty = false;
    letterNode = null;
    closeAllDialogs();
  }
  state.appHash = location.hash;
  const def = ROUTES[route.name];
  updateNav(route.name);

  const m = mainEl();
  const focusKey = quiet ? d.activeElement?.closest?.('[data-fkey]')?.dataset.fkey : null;
  const scrollY = window.scrollY;
  let loaderTimer = 0;
  if (!quiet) {
    loaderTimer = setTimeout(() => { if (seq === routeSeq) m.replaceChildren(viewLoading()); }, 160);
  }
  m.setAttribute('aria-busy', 'true');

  let node;
  try {
    const [, data] = await Promise.all([refreshMe(), def.load ? def.load(route) : null]);
    if (seq !== routeSeq || !state.me) return;
    node = def.render(data, route);
    d.title = `${def.title(data, route)} · Mikołaj`;
  } catch (err) {
    if (seq !== routeSeq || !state.me || err?.status === 401) return;
    if (quiet) {
      if (!silent) toast(`Nie udało się odświeżyć widoku. ${messageOf(err)}`, { tone: 'error' });
      return;
    }
    node = viewError(err, () => renderRoute(), route.name === 'member');
    d.title = 'Błąd · Mikołaj';
  } finally {
    clearTimeout(loaderTimer);
    if (seq === routeSeq) m.removeAttribute('aria-busy');
  }

  m.replaceChildren(node);
  state.justChanged = null;
  if (quiet) {
    window.scrollTo(0, scrollY);
    if (focusKey) {
      const next = d.querySelector(`[data-fkey="${CSS.escape(focusKey)}"]`);
      if (next && !d.querySelector('dialog[open]')) next.focus({ preventScroll: true });
    }
  } else {
    window.scrollTo(0, 0);
    if (!initial) focusHeading();
  }
}

const refreshView = () => renderRoute({ quiet: true });

async function act(btn, call, { success, changed } = {}) {
  if (!btn || btn.disabled) return;
  setBusy(btn, true);
  try {
    await call();
    state.justChanged = changed ?? null;
    await refreshView();
    if (success) toast(success, { tone: 'success' });
  } catch (err) {
    if (err?.status === 401) return;
    toast(messageOf(err), { tone: 'error' });
    if (err?.status === 409 || err?.status === 404 || err?.status === 403) await refreshView();
  } finally {
    if (btn.isConnected) setBusy(btn, false);
  }
}

// ---------- Widoki pomocnicze ----------

function viewLoading(label = 'Wczytywanie…') {
  return h('div', { class: 'loading', role: 'status' }, art('loader'), h('span', { class: 'loading__label', text: label }));
}

function viewError(err, retry, withBack = false) {
  const retryBtn = h('button', { type: 'button', class: 'btn btn--ink' }, icon('refresh'), 'Spróbuj ponownie');
  retryBtn.addEventListener('click', retry);
  return h('section', { class: 'state container' },
    art('empty-letter'),
    h('h1', { class: 'state__title', tabindex: '-1', text: 'Nie udało się wczytać' }),
    h('p', { class: 'state__text', text: messageOf(err) }),
    h('div', { class: 'state__actions' },
      retryBtn,
      withBack ? h('a', { class: 'btn btn--secondary', href: '#/' }, icon('arrow-left'), 'Wróć do rodziny') : null));
}

function viewNotFound() {
  return h('section', { class: 'state container' },
    art('empty-letter'),
    h('h1', { class: 'state__title', tabindex: '-1', text: 'Tej strony tu nie ma' }),
    h('p', { class: 'state__text', text: 'Może list zmienił adres? Wróć na stronę rodziny.' }),
    h('div', { class: 'state__actions' }, h('a', { class: 'btn btn--ink', href: '#/' }, icon('family'), 'Strona rodziny')));
}

function pageHead({ eyebrow, title, lede }) {
  return h('header', { class: 'page-head' },
    eyebrow ? h('p', { class: 'eyebrow', text: eyebrow }) : null,
    h('h1', { class: 'display', tabindex: '-1', text: title }),
    lede ? h('p', { class: 'lede', text: lede }) : null);
}

function countChip(n) {
  if (!n) return null;
  return h('span', { class: 'count-chip' }, String(n), h('span', { class: 'sr-only', text: ` ${plural(n, FORMS.wish)}` }));
}

function emptyState({ artName, title, text, action, level = 'h3' }) {
  return h('div', { class: 'empty' },
    art(artName),
    h(level, { class: 'empty__title', text: title }),
    h('p', { class: 'empty__text', text }),
    action || null);
}

// ---------- Strona rodziny ----------

function countdown() {
  const c = christmas();
  if (c.kind === 'eve') {
    return h('div', { class: 'countdown countdown--fest' },
      h('span', { class: 'countdown__band', text: '24 grudnia' }),
      h('span', { class: 'countdown__num', text: 'Dziś Wigilia!' }));
  }
  if (c.kind === 'holiday') {
    return h('div', { class: 'countdown countdown--fest' },
      h('span', { class: 'countdown__band', text: 'Grudzień' }),
      h('span', { class: 'countdown__num', text: 'Wesołych Świąt!' }));
  }
  return h('div', { class: 'countdown' },
    h('span', { class: 'countdown__band', text: 'Do Wigilii' }),
    h('span', { class: 'countdown__num', text: String(c.days) }),
    h('span', { class: 'countdown__unit', text: plural(c.days, FORMS.day) }));
}

function viewHome() {
  const { user, family, members } = state.me;
  const self = members.find(m => m.id === user.id) || { id: user.id, name: user.name, letter: '', wishCount: 0 };
  const others = members.filter(m => m.id !== user.id).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const totalWishes = members.reduce((n, m) => n + m.wishCount, 0);

  const hero = h('section', { class: 'home-hero' },
    h('div', { class: 'home-hero__text' },
      h('p', { class: 'eyebrow', text: family.name }),
      h('h1', { class: 'display', tabindex: '-1' }, `${greeting()}, `, h('em', { text: firstName(user.name) }), '.'),
      h('p', { class: 'lede', text: others.length
        ? 'Wybierz kopertę, żeby przeczytać list i po cichu zarezerwować prezent.'
        : 'Tu pojawią się listy Twoich bliskich, gdy tylko dołączą.' }),
      h('ul', { class: 'chips', role: 'list' },
        h('li', { class: 'chip' }, icon('family', 'icon icon--sm'), `${count(members.length || 1, FORMS.person)} w rodzinie`),
        h('li', { class: 'chip' }, icon('gift', 'icon icon--sm'), `${count(totalWishes, FORMS.wish)} na listach`))),
    countdown());

  const hasLetter = self.letter.trim().length > 0;
  const selfSection = h('section', { class: 'home-section', 'aria-labelledby': 'self-h' },
    h('h2', { class: 'section-title', id: 'self-h', text: 'Twój list' }),
    h('a', { class: 'self-card', href: '#/moja-lista' },
      h('span', { class: 'self-card__art' }, art('step-letter')),
      h('span', { class: 'self-card__body' },
        h('span', { class: 'self-card__title', text: hasLetter ? 'Drogi Mikołaju,' : 'Napisz swój list' }),
        h('span', { class: 'self-card__text', text: hasLetter ? snippet(self.letter, 150) : 'Kilka słów o tym, co lubisz, pomoże bliskim trafić z prezentem.' }),
        h('span', { class: 'self-card__meta', text: self.wishCount ? `Na liście: ${count(self.wishCount, FORMS.wish)}` : 'Lista życzeń jest jeszcze pusta' })),
      h('span', { class: 'self-card__cta' }, hasLetter || self.wishCount ? 'Otwórz mój list' : 'Zacznij pisać', icon('arrow-right'))));

  const familySection = h('section', { class: 'home-section', 'aria-labelledby': 'family-h' },
    h('h2', { class: 'section-title', id: 'family-h', text: 'Listy rodziny' }));

  if (!others.length) {
    familySection.append(emptyState({
      artName: 'alone',
      title: 'Na razie jesteś tu tylko Ty',
      text: user.isAdmin
        ? 'Wyślij bliskim prywatny link zaproszenia. Gdy dołączą, ich koperty pojawią się właśnie tutaj.'
        : 'Gdy dołączą kolejne osoby, ich listy pojawią się właśnie tutaj. Link zaproszenia ma osoba, która założyła rodzinę.',
      action: user.isAdmin ? h('a', { class: 'btn btn--primary', href: '#/zaproszenie' }, icon('link'), 'Zaproś bliskich') : null,
    }));
  } else {
    const grid = h('ul', { class: 'envelopes', role: 'list' }, others.map(m => h('li', null, envelopeCard(m))));
    if (user.isAdmin) {
      grid.append(h('li', null, h('a', { class: 'envelope envelope--invite', href: '#/zaproszenie' },
        h('span', { class: 'plus', 'aria-hidden': 'true' }, icon('plus', 'icon icon--lg')),
        h('strong', { text: 'Zaproś kolejną osobę' }),
        h('span', { text: 'Prywatny link dla bliskich' }))));
    }
    familySection.append(grid);
  }

  return h('div', { class: 'page container' }, hero, selfSection, familySection);
}

function envelopeCard(m) {
  const text = snippet(m.letter, 120);
  return h('a', { class: `envelope tone-${toneFor(m.id)}`, href: `#/osoba/${encodeURIComponent(m.id)}` },
    art('flap'),
    sealMark('envelope__seal'),
    h('span', { class: 'envelope__body' },
      h('span', { class: 'envelope__to', text: 'List od' }),
      h('span', { class: 'envelope__name', text: m.name }),
      h('span', { class: `envelope__snippet${text ? '' : ' is-empty'}`, text: text ? `„${text}”` : 'List jeszcze bez treści.' })),
    h('span', { class: 'stamp', 'aria-hidden': 'true' }, h('span', { class: 'stamp__face', text: initial(m.name) })),
    h('span', { class: 'envelope__foot' },
      h('span', { class: 'envelope__count' }, icon('gift', 'icon icon--sm'), m.wishCount ? count(m.wishCount, FORMS.wish) : 'Brak życzeń'),
      h('span', { class: 'envelope__open', 'aria-hidden': 'true' }, 'Otwórz', icon('arrow-right', 'icon icon--sm'))));
}

// ---------- Mój list ----------

function viewMine({ member, wishes }) {
  const editor = state.editingLetter && letterNode ? letterNode : (letterNode = letterEditor(member.letter, state.me.user.name));
  const addBtn = h('button', { type: 'button', class: 'btn btn--primary', 'data-fkey': 'add-wish' }, icon('plus'), 'Dodaj życzenie');
  addBtn.addEventListener('click', () => openWishDialog(null));

  const list = wishes.length
    ? h('ul', { class: 'wish-list', role: 'list' }, wishes.map(w => h('li', null, ownWishCard(w))))
    : emptyState({
      artName: 'empty-letter',
      title: 'Lista jest jeszcze pusta',
      text: 'Dodaj pierwsze życzenie. Może być konkretne — z linkiem i ceną — albo całkiem ogólne, np. „dobra książka o górach”.',
      action: (() => {
        const b = h('button', { type: 'button', class: 'btn btn--ink', 'data-fkey': 'add-first' }, icon('plus'), 'Dodaj pierwsze życzenie');
        b.addEventListener('click', () => openWishDialog(null));
        return b;
      })(),
    });

  return h('div', { class: 'page container' },
    pageHead({ eyebrow: 'Twój list', title: 'Mój list do Mikołaja', lede: 'Napisz kilka słów i dodaj życzenia. Bliscy zobaczą je na Twojej kopercie.' }),
    h('section', { class: 'privacy', 'aria-label': 'Prywatność Twojej listy' },
      h('span', { class: 'privacy__seal', 'aria-hidden': 'true' }, icon('eye-off')),
      h('div', null,
        h('p', { class: 'privacy__title', text: 'Ktoś coś szykuje? Tego nie zdradzimy.' }),
        h('p', { class: 'privacy__text', text: 'Na własnej liście nie zobaczysz rezerwacji, zakupów ani tego, kto się czym zajął. Niespodzianka zostaje niespodzianką.' }))),
    h('div', { class: 'split' },
      h('div', { class: 'split__aside' }, editor),
      h('section', { class: 'split__main', 'aria-labelledby': 'wishes-h' },
        h('div', { class: 'section-head' },
          h('div', { class: 'section-head__title' },
            h('h2', { class: 'section-title', id: 'wishes-h', text: 'Życzenia' }),
            countChip(wishes.length)),
          wishes.length ? addBtn : null),
        list)));
}

function letterEditor(initialText, signature) {
  let saved = initialText;
  const root = h('section', { class: 'letter', 'aria-labelledby': 'letter-h' });

  const show = () => {
    state.editingLetter = false;
    state.letterDirty = false;
    const has = saved.trim().length > 0;
    const editBtn = h('button', { type: 'button', class: 'btn btn--secondary', 'data-fkey': 'letter-edit' }, icon('edit'), has ? 'Edytuj list' : 'Napisz list');
    editBtn.addEventListener('click', edit);
    root.replaceChildren(
      h('h2', { class: 'sr-only', id: 'letter-h', text: 'Twój list' }),
      h('div', { class: 'letter__paper' },
        h('p', { class: 'letter__salutation', text: 'Drogi Mikołaju,' }),
        has
          ? h('p', { class: 'letter__text', text: saved })
          : h('p', { class: 'letter__text letter__text--empty', text: 'Tu jeszcze nic nie ma. Napisz, co Cię cieszy, jaki nosisz rozmiar, co już masz — i czego na pewno nie chcesz.' }),
        has ? h('p', { class: 'letter__sign', text: signature }) : null),
      h('div', { class: 'letter__actions' }, editBtn));
  };

  const edit = () => {
    state.editingLetter = true;
    letterNode = root;
    const alert = formAlert();
    const textarea = h('textarea', {
      id: 'letter-input', class: 'letter__input', maxlength: LIMITS.letter, rows: 9,
      placeholder: 'Piszę do Ciebie, bo…', 'aria-describedby': 'letter-count',
    });
    textarea.value = saved;
    const counter = h('p', { id: 'letter-count', class: 'letter__count' });
    const save = h('button', { type: 'submit', class: 'btn btn--primary' }, icon('check'), 'Zapisz list');
    const cancel = h('button', { type: 'button', class: 'btn btn--ghost' }, 'Anuluj');
    const update = () => {
      counter.textContent = `${textarea.value.length} / ${LIMITS.letter} · Ctrl + Enter zapisuje`;
      state.letterDirty = textarea.value !== saved;
    };
    const finish = () => { show(); $('[data-fkey="letter-edit"]', root)?.focus(); };
    let busy = false;

    const form = h('form', { class: 'letter__form', novalidate: true },
      h('div', { class: 'letter__paper letter__paper--editing' },
        h('p', { class: 'letter__salutation', 'aria-hidden': 'true', text: 'Drogi Mikołaju,' }),
        h('label', { class: 'sr-only', for: 'letter-input', text: 'Treść listu do Mikołaja' }),
        textarea,
        counter),
      alert.el,
      h('div', { class: 'letter__actions' }, save, cancel));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (busy) return;
      alert.clear();
      const text = textarea.value.trim();
      if (text.length > LIMITS.letter) { alert.show(`List może mieć najwyżej ${LIMITS.letter} znaków.`); return; }
      busy = true; setBusy(save, true); cancel.disabled = true;
      try {
        await api('PATCH', '/api/letter', { letter: text });
        saved = text;
        finish();
        toast('List zapisany.', { tone: 'success' });
        refreshMe().catch(() => {});
      } catch (err) {
        if (err?.status !== 401) alert.show(messageOf(err));
      } finally {
        busy = false;
        if (save.isConnected) { setBusy(save, false); cancel.disabled = false; }
      }
    });
    cancel.addEventListener('click', finish);
    textarea.addEventListener('input', update);
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); }
      else if (e.key === 'Escape' && !state.letterDirty) { e.preventDefault(); finish(); }
    });
    update();
    root.replaceChildren(h('h2', { class: 'sr-only', id: 'letter-h', text: 'Twój list' }), form);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  };

  show();
  return root;
}

function wishCardBase(w, { extraClass = '', stamp = null } = {}) {
  const titleId = uid('w');
  const article = h('article', { class: `wish${extraClass ? ` ${extraClass}` : ''}`, 'aria-labelledby': titleId },
    stamp,
    h('div', { class: 'wish__head' },
      h('h3', { class: 'wish__title', id: titleId, text: w.title }),
      w.price !== null ? h('p', { class: 'wish__price' }, h('span', { class: 'sr-only', text: 'Cena: ' }), formatPrice(w.price)) : null),
    w.note ? h('p', { class: 'wish__note', text: w.note }) : null,
    w.url ? h('a', { class: 'wish__link', href: w.url, target: '_blank', rel: 'noopener noreferrer' },
      icon('external', 'icon icon--sm'),
      h('span', { text: displayHost(w.url) }),
      h('span', { class: 'sr-only', text: ' (otwiera się w nowej karcie)' })) : null);
  return article;
}

function stampEl(text, tone, wishId) {
  return h('span', {
    class: `seal-stamp${tone === 'pine' ? ' seal-stamp--pine' : ''}${state.justChanged === wishId ? ' is-new' : ''}`,
    'aria-hidden': 'true',
    text,
  });
}

function ownWishCard(w) {
  const card = wishCardBase(w);
  const edit = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', 'data-fkey': `edit-${w.id}`, 'aria-label': `Edytuj: ${w.title}` }, icon('edit', 'icon icon--sm'), 'Edytuj');
  const del = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-fkey': `del-${w.id}`, 'aria-label': `Usuń: ${w.title}` }, icon('trash', 'icon icon--sm'), 'Usuń');
  edit.addEventListener('click', () => openWishDialog(w));
  del.addEventListener('click', () => confirmAction({
    title: 'Usunąć życzenie?',
    message: `„${w.title}” zniknie z Twojej listy. Tej operacji nie można cofnąć.`,
    confirmLabel: 'Usuń życzenie',
    action: async () => {
      await api('DELETE', `/api/wishes/${encodeURIComponent(w.id)}`);
      await refreshView();
      toast('Życzenie usunięte.', { tone: 'success' });
    },
  }));
  card.append(h('div', { class: 'wish__foot' }, h('span', { class: 'wish__status', text: 'Widoczne dla rodziny' }), edit, del));
  return card;
}

function openWishDialog(existing) {
  const editing = Boolean(existing);
  const fTitle = field({ label: 'Czego sobie życzysz?', name: 'title', required: true, maxlength: LIMITS.title, value: existing?.title, placeholder: 'np. Wełniany szalik w kolorze butelkowej zieleni', autocomplete: 'off' });
  const fNote = field({ label: 'Notatka', name: 'note', multiline: true, rows: 3, optional: true, maxlength: LIMITS.note, value: existing?.note, hint: 'Rozmiar, kolor, wariant, gdzie kupić — wszystko, co pomoże trafić.' });
  const fUrl = field({ label: 'Link', name: 'url', type: 'url', inputmode: 'url', optional: true, maxlength: LIMITS.url, value: existing?.url ?? '', placeholder: 'https://…', spellcheck: false, autocapitalize: 'none', autocomplete: 'off' });
  const fPrice = field({
    label: 'Cena w złotych', name: 'price', inputmode: 'decimal', optional: true, autocomplete: 'off', placeholder: 'np. 149,99',
    value: existing && existing.price !== null ? priceInputValue(existing.price) : '',
    trailing: h('span', { class: 'field__suffix', 'aria-hidden': 'true', text: 'zł' }),
  });
  const alert = formAlert();
  const cancel = h('button', { type: 'button', class: 'btn btn--secondary' }, 'Anuluj');
  const save = h('button', { type: 'submit', class: 'btn btn--primary' }, editing ? 'Zapisz zmiany' : 'Dodaj do listy');
  const form = h('form', { class: 'form dialog__body', novalidate: true },
    fTitle.wrap, fNote.wrap,
    h('div', { class: 'form__row' }, fUrl.wrap, fPrice.wrap),
    alert.el,
    h('div', { class: 'dialog__actions' }, cancel, save));
  const dlg = openDialog({ title: editing ? 'Edytuj życzenie' : 'Nowe życzenie', body: form, initialFocus: () => fTitle.control });
  cancel.addEventListener('click', () => dlg.close());

  bindSubmit({
    form, button: save, alert,
    fields: { title: fTitle, note: fNote, url: fUrl, price: fPrice },
    onBusy: on => { dlg.setBusy(on); cancel.disabled = on; },
    validate: v => {
      const out = {};
      const title = v.title.trim();
      if (!title) out.title = 'Wpisz, czego sobie życzysz.';
      else if (title.length > LIMITS.title) out.title = `Maksymalnie ${LIMITS.title} znaków.`;
      if (v.note.trim().length > LIMITS.note) out.note = `Maksymalnie ${LIMITS.note} znaków.`;
      const url = parseUrlInput(v.url);
      if (url.error) out.url = url.error;
      const price = parsePriceInput(v.price);
      if (price.error) out.price = price.error;
      return out;
    },
    run: async v => {
      const body = {
        title: v.title.trim(),
        note: v.note.trim(),
        url: parseUrlInput(v.url).value,
        price: parsePriceInput(v.price).value,
      };
      if (editing) await api('PATCH', `/api/wishes/${encodeURIComponent(existing.id)}`, body);
      else await api('POST', '/api/wishes', body);
      dlg.setBusy(false);
      dlg.close();
      await refreshView();
      toast(editing ? 'Zapisano zmiany.' : `Dodano do listy: ${body.title}`, { tone: 'success' });
    },
  });
}

// ---------- List innej osoby ----------

function viewMember({ member, wishes }) {
  const free = wishes.filter(w => !w.reserved).length;
  const hasLetter = member.letter.trim().length > 0;
  const lede = wishes.length
    ? `${count(wishes.length, FORMS.wish)} na liście · wolne: ${free}`
    : null;

  const list = wishes.length
    ? h('ul', { class: 'wish-list', role: 'list' }, wishes.map(w => h('li', null, otherWishCard(w))))
    : emptyState({
      artName: 'empty-letter',
      title: 'Na tej liście nie ma jeszcze życzeń',
      text: `Gdy ${member.name} coś doda, pojawi się to tutaj. Zajrzyj później.`,
    });

  return h('div', { class: 'page container' },
    h('a', { class: 'back-link', href: '#/' }, icon('arrow-left'), 'Wszystkie listy'),
    pageHead({ eyebrow: 'List od', title: member.name, lede }),
    h('p', { class: 'quiet-note' }, icon('lock', 'icon icon--sm'),
      h('span', { text: `${member.name} nie widzi rezerwacji. Ty też nie zobaczysz, kto zarezerwował pozostałe prezenty.` })),
    h('div', { class: 'split' },
      h('div', { class: 'split__aside' },
        h('section', { class: 'letter', 'aria-labelledby': 'letter-h' },
          h('h2', { class: 'sr-only', id: 'letter-h', text: `List: ${member.name}` }),
          h('div', { class: 'letter__paper' },
            h('p', { class: 'letter__salutation', text: 'Drogi Mikołaju,' }),
            hasLetter
              ? h('p', { class: 'letter__text', text: member.letter })
              : h('p', { class: 'letter__text letter__text--empty', text: 'Ten list nie ma jeszcze treści. Może życzenia obok powiedzą więcej.' }),
            hasLetter ? h('p', { class: 'letter__sign', text: member.name }) : null))),
      h('section', { class: 'split__main', 'aria-labelledby': 'wishes-h' },
        h('div', { class: 'section-head' },
          h('div', { class: 'section-head__title' },
            h('h2', { class: 'section-title', id: 'wishes-h', text: 'Życzenia' }),
            countChip(wishes.length))),
        list)));
}

function purchasedToggle(w) {
  const btn = h('button', {
    type: 'button', class: 'toggle', 'aria-pressed': String(w.purchased),
    'data-fkey': `buy-${w.id}`, 'aria-label': `Kupione: ${w.title}`,
  },
  h('span', { class: 'toggle__box', 'aria-hidden': 'true' }, icon('check', 'icon icon--sm')),
  h('span', { text: 'Kupione' }));
  btn.addEventListener('click', () => act(btn,
    () => api('PATCH', `/api/wishes/${encodeURIComponent(w.id)}/reserve`, { purchased: !w.purchased }),
    { success: w.purchased ? `Cofnięto oznaczenie zakupu: ${w.title}` : `Oznaczono jako kupione: ${w.title}`, changed: w.id }));
  return btn;
}

function cancelReservationButton(w) {
  const btn = h('button', {
    type: 'button', class: 'btn btn--ghost btn--sm',
    'data-fkey': `cancel-${w.id}`, 'aria-label': `Zrezygnuj z rezerwacji: ${w.title}`,
  }, icon('undo', 'icon icon--sm'), 'Zrezygnuj');
  const run = () => api('DELETE', `/api/wishes/${encodeURIComponent(w.id)}/reserve`);
  btn.addEventListener('click', () => {
    if (w.purchased) {
      confirmAction({
        title: 'Zrezygnować z rezerwacji?',
        message: `„${w.title}” jest oznaczone jako kupione. Po rezygnacji prezent znów będzie wolny i ktoś inny może go zarezerwować.`,
        confirmLabel: 'Zrezygnuj',
        action: async () => { await run(); await refreshView(); toast(`Zwolniono rezerwację: ${w.title}`, { tone: 'success' }); },
      });
    } else {
      act(btn, run, { success: `Zwolniono rezerwację: ${w.title}` });
    }
  });
  return btn;
}

function otherWishCard(w) {
  if (!w.reserved) {
    const card = wishCardBase(w);
    const reserve = h('button', {
      type: 'button', class: 'btn btn--primary btn--sm',
      'data-fkey': `res-${w.id}`, 'aria-label': `Zarezerwuj: ${w.title}`,
    }, icon('gift', 'icon icon--sm'), 'Zarezerwuj');
    reserve.addEventListener('click', () => act(reserve,
      () => api('POST', `/api/wishes/${encodeURIComponent(w.id)}/reserve`, {}),
      { success: `Zarezerwowano: ${w.title}. Nikt nie dowie się, że to Ty.`, changed: w.id }));
    card.append(h('div', { class: 'wish__foot' }, h('span', { class: 'wish__status', text: 'Wolne' }), reserve));
    return card;
  }
  if (w.reservedByMe) {
    // Zakup dotyczy wersji z chwili rezerwacji — nie przypisujemy go zmienionemu życzeniu.
    const changed = w.changedSinceReservation === true;
    const bought = w.purchased && !changed;
    const card = wishCardBase(w, { extraClass: 'wish--mine', stamp: stampEl(bought ? 'Kupione' : 'Twoje', 'pine', w.id) });
    if (changed) {
      card.append(changedNotice('Autor zmienił to życzenie po Twojej rezerwacji. Wersję z chwili rezerwacji i status zakupu znajdziesz w Moich rezerwacjach.',
        h('a', { class: 'text-link', href: '#/rezerwacje' }, 'Przejdź do moich rezerwacji', icon('arrow-right', 'icon icon--sm'))));
    }
    card.append(h('div', { class: 'wish__foot' },
      h('span', { class: 'wish__status wish__status--mine' }, icon('check', 'icon icon--sm'), bought ? 'Kupione przez Ciebie' : 'Twoja rezerwacja'),
      changed ? null : purchasedToggle(w),
      cancelReservationButton(w)));
    return card;
  }
  const card = wishCardBase(w, { extraClass: 'wish--taken', stamp: stampEl(w.purchased ? 'Kupione' : 'Zajęte', 'red', w.id) });
  card.append(h('div', { class: 'wish__foot' },
    h('span', { class: 'wish__status wish__status--taken', text: w.purchased ? 'Ktoś już to kupił.' : 'Ktoś już to szykuje.' })));
  return card;
}

// ---------- Moje rezerwacje ----------

function viewReservations(wishes) {
  const head = pageHead({
    eyebrow: 'Tylko dla Ciebie',
    title: 'Moje rezerwacje',
    lede: 'Prezenty, którymi się zajmujesz. Inni widzą tylko, że są zajęte — nie wiedzą, przez kogo.',
  });
  if (!wishes.length) {
    return h('div', { class: 'page container' }, head, emptyState({
      level: 'h2',
      artName: 'empty-gift',
      title: 'Nie masz jeszcze rezerwacji',
      text: 'Otwórz list kogoś z rodziny i wybierz prezent. Zarezerwowane rzeczy trafią tutaj — razem z listą zakupów.',
      action: h('a', { class: 'btn btn--ink', href: '#/' }, icon('family'), 'Przejrzyj listy rodziny'),
    }));
  }

  const bought = wishes.filter(w => w.purchased).length;
  const priced = wishes.filter(w => w.price !== null);
  const sum = Math.round(priced.reduce((s, w) => s + w.price, 0) * 100) / 100;
  const unpriced = wishes.length - priced.length;

  const groups = new Map();
  for (const w of wishes) {
    const key = w.ownerId || w.ownerName;
    if (!groups.has(key)) groups.set(key, { ownerId: w.ownerId, ownerName: w.ownerName, items: [] });
    groups.get(key).items.push(w);
  }

  const tally = h('dl', { class: 'tally' },
    h('div', { class: 'tally__item' }, h('dt', { text: 'Rezerwacje' }), h('dd', { text: String(wishes.length) })),
    h('div', { class: 'tally__item' }, h('dt', { text: 'Kupione' }), h('dd', null, `${bought}`, h('small', { text: `z ${wishes.length}` }))),
    h('div', { class: 'tally__item' }, h('dt', { text: 'Razem' }),
      h('dd', null, priced.length ? formatPrice(sum) : '—', unpriced ? h('small', { text: `bez ceny: ${unpriced}` }) : null)));

  const progress = h('progress', { class: 'progress', max: String(wishes.length), value: String(bought), 'aria-label': `Kupione: ${bought} z ${wishes.length}` });

  const sections = [...groups.values()].map(g => {
    const headingId = uid('g');
    return h('section', { class: 'group', 'aria-labelledby': headingId },
      h('div', { class: 'group__head' },
        h('h2', { class: 'group__title', id: headingId }, h('span', { text: 'dla' }), g.ownerName),
        g.ownerId ? h('a', { class: 'text-link', href: `#/osoba/${encodeURIComponent(g.ownerId)}` }, 'Zobacz list', icon('arrow-right', 'icon icon--sm')) : null),
      h('ul', { class: 'wish-list', role: 'list' }, g.items.map(w => h('li', null, reservedWishCard(w)))));
  });

  return h('div', { class: 'page container' }, head, tally, progress, sections);
}

function changedNotice(text, link) {
  return h('div', { class: 'callout callout--note', role: 'note' },
    icon('alert'),
    h('div', { class: 'callout__body' },
      h('p', { text }),
      link ? h('p', null, link) : null));
}

function reservedWishCard(w) {
  const card = wishCardBase(w, { extraClass: 'wish--mine', stamp: w.purchased ? stampEl('Kupione', 'pine', w.id) : null });
  if (w.changedSinceReservation) {
    card.append(w.ownerId
      ? changedNotice('Autor zmienił życzenie. Tu zachowaliśmy dane z chwili rezerwacji.',
        h('a', { class: 'text-link', href: `#/osoba/${encodeURIComponent(w.ownerId)}` },
          'Sprawdź aktualną listę', h('span', { class: 'sr-only', text: `: ${w.ownerName}` }), icon('arrow-right', 'icon icon--sm')))
      : changedNotice('Autor zmienił życzenie. Tu zachowaliśmy dane z chwili rezerwacji. Sprawdź aktualną listę.'));
  }
  card.append(h('div', { class: 'wish__foot' },
    h('span', { class: 'wish__status wish__status--mine', text: w.purchased ? 'Kupione' : 'Do kupienia' }),
    purchasedToggle(w),
    cancelReservationButton(w)));
  return card;
}

// ---------- Zaproszenia ----------

function viewInvite() {
  const { user, family } = state.me;
  if (!user.isAdmin) {
    return h('div', { class: 'page container' },
      pageHead({
        eyebrow: 'Zaproszenia',
        title: 'Zaproszenia',
        lede: 'Link zaproszenia udostępnia osoba, która założyła rodzinę w Mikołaju. Poproś ją o link dla nowych członków rodziny.',
      }),
      h('a', { class: 'btn btn--secondary', href: '#/' }, icon('arrow-left'), 'Wróć do rodziny'));
  }

  const area = h('div', { class: 'invite__area' });
  renderInviteArea(area);

  const rotate = h('button', { type: 'button', class: 'btn btn--danger', 'data-fkey': 'invite-rotate' }, icon('refresh'), 'Wygeneruj nowy link');
  rotate.addEventListener('click', () => confirmAction({
    title: 'Wygenerować nowy link?',
    message: 'Poprzedni link przestanie działać — nikt już przez niego nie dołączy. Nowy link trzeba będzie wysłać ponownie.',
    confirmLabel: 'Wygeneruj nowy link',
    action: async () => {
      state.inviteUrl = normInviteUrl(await api('POST', '/api/invite', {}));
      await refreshView();
      toast('Nowy link gotowy. Poprzedni już nie działa.', { tone: 'success' });
    },
  }));

  return h('div', { class: 'page container' },
    pageHead({ eyebrow: 'Zaproszenia', title: 'Zaproś rodzinę', lede: `Każda osoba z linkiem może dołączyć do rodziny „${family.name}”, zobaczyć listy i rezerwować prezenty.` }),
    h('div', { class: 'invite' },
      h('section', { class: 'invite__card paper', 'aria-labelledby': 'invite-h' },
        h('div', { class: 'invite__art' }, art('step-seal')),
        h('h2', { class: 'section-title', id: 'invite-h', text: 'Prywatny link zaproszenia' }),
        h('p', { class: 'muted', text: 'Wysyłaj go tylko bliskim, w prywatnej wiadomości. Nie publikuj go w mediach społecznościowych ani w grupach, do których należą obce osoby.' }),
        area),
      h('aside', { class: 'invite__aside', 'aria-label': 'Jak zapraszać' },
        h('h2', { class: 'section-title', text: 'Jak to działa' }),
        h('ol', { class: 'mini-steps', role: 'list' },
          h('li', { text: 'Skopiuj link i wyślij go SMS-em lub w komunikatorze. Mikołaj sam nie wysyła e-maili.' }),
          h('li', { text: 'Bliska osoba otwiera link i podaje imię, e-mail oraz hasło.' }),
          h('li', { text: 'Gotowe — jej koperta pojawi się na stronie rodziny.' })),
        h('div', { class: 'danger-zone' },
          h('h3', { text: 'Link trafił w niepowołane ręce?' }),
          h('p', { text: 'Wygeneruj nowy. Poprzedni od razu przestanie działać, a konta osób, które już dołączyły, pozostaną bez zmian.' }),
          rotate))));
}

function renderInviteArea(area) {
  if (!state.inviteUrl) {
    const alert = formAlert();
    const reveal = h('button', { type: 'button', class: 'btn btn--ink', 'data-fkey': 'invite-reveal' }, icon('eye'), 'Pokaż link zaproszenia');
    reveal.addEventListener('click', async () => {
      if (reveal.disabled) return;
      alert.clear();
      setBusy(reveal, true);
      try {
        state.inviteUrl = normInviteUrl(await api('GET', '/api/invite'));
        renderInviteArea(area);
        $('#invite-url', area)?.focus();
      } catch (err) {
        if (err?.status !== 401) alert.show(messageOf(err));
      } finally {
        if (reveal.isConnected) setBusy(reveal, false);
      }
    });
    area.replaceChildren(h('div', null, reveal), alert.el);
    return;
  }

  const url = state.inviteUrl;
  const input = h('input', { id: 'invite-url', class: 'input input--mono', type: 'text', readonly: true, spellcheck: 'false', autocomplete: 'off', 'aria-describedby': 'invite-url-hint' });
  input.value = url;
  input.addEventListener('focus', () => input.select());

  const copyLabel = h('span', { text: 'Kopiuj link' });
  const copy = h('button', { type: 'button', class: 'btn btn--primary', 'data-fkey': 'invite-copy' }, icon('copy'), copyLabel);
  let resetTimer = 0;
  copy.addEventListener('click', async () => {
    const ok = await copyText(url, input);
    if (ok) {
      copy.replaceChildren(icon('check'), h('span', { text: 'Skopiowano' }));
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { if (copy.isConnected) copy.replaceChildren(icon('copy'), h('span', { text: 'Kopiuj link' })); }, 2200);
      toast('Link skopiowany. Wyślij go bliskim w prywatnej wiadomości.', { tone: 'success' });
    } else {
      input.focus();
      input.select();
      toast('Nie udało się skopiować automatycznie. Link jest zaznaczony — skopiuj go ręcznie.', { tone: 'error' });
    }
  });

  const more = h('div', { class: 'invite__more' });
  if (typeof navigator.share === 'function') {
    const share = h('button', { type: 'button', class: 'btn btn--secondary btn--sm' }, icon('share', 'icon icon--sm'), 'Udostępnij');
    share.addEventListener('click', async () => {
      try {
        await navigator.share({ title: 'Zaproszenie do Mikołaja', text: `Dołącz do rodziny „${state.me.family.name}” w Mikołaju.`, url });
      } catch (err) {
        if (err?.name !== 'AbortError') toast('Nie udało się otworzyć udostępniania. Skopiuj link ręcznie.', { tone: 'error' });
      }
    });
    more.append(share);
  }
  const hide = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, icon('eye-off', 'icon icon--sm'), 'Ukryj link');
  hide.addEventListener('click', () => {
    state.inviteUrl = null;
    renderInviteArea(area);
    $('[data-fkey="invite-reveal"]', area)?.focus();
  });
  more.append(hide);

  area.replaceChildren(
    h('label', { class: 'field__label', for: 'invite-url', text: 'Link zaproszenia' }),
    h('div', { class: 'copy-row' }, input, copy),
    h('p', { id: 'invite-url-hint', class: 'field__hint', text: 'Link działa, dopóki nie wygenerujesz nowego.' }),
    more);
}

async function copyText(text, input) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* przechodzimy do zapasowej metody */ }
  try {
    input.focus();
    input.select();
    return d.execCommand('copy');
  } catch { return false; }
}

// ---------- Zdarzenia globalne ----------

function isInteracting() {
  if (d.querySelector('dialog[open]')) return true;
  if (state.editingLetter || inflight > 0) return true;
  const active = d.activeElement;
  return Boolean(active && active.matches('input, textarea, select') && mainEl().contains(active));
}

function anyFieldFilled() {
  return [...mainEl().querySelectorAll('input, textarea')].some(el => el.value);
}

function onHashChange() {
  const link = readLinkFragment();
  if (!state.me) {
    if (link) {
      applyLink(link);
      renderWelcome();
      if (state.tokens.invite) checkInvitation();
    }
    return;
  }
  if (link) {
    state.pendingLink = link.token ? link : null;
    history.replaceState(null, '', state.appHash || location.pathname + location.search);
    renderPendingNotice();
    if (!link.token) toast('Ten link jest niekompletny albo uszkodzony.', { tone: 'error' });
    return;
  }
  if (state.letterDirty) {
    const target = location.hash;
    history.replaceState(null, '', state.appHash || location.pathname + location.search);
    confirmAction({
      title: 'Porzucić zmiany w liście?',
      message: 'Masz niezapisane zmiany w liście do Mikołaja. Jeśli przejdziesz dalej, przepadną.',
      confirmLabel: 'Porzuć zmiany',
      action: async () => {
        state.letterDirty = false;
        state.editingLetter = false;
        location.hash = target;
      },
    });
    return;
  }
  renderRoute();
}

async function onVisible() {
  if (d.visibilityState !== 'visible' || state.booting) return;
  if (Date.now() - state.lastVisibleRefresh < 4000) return;
  state.lastVisibleRefresh = Date.now();
  if (state.me) {
    if (!isInteracting()) renderRoute({ quiet: true, silent: true });
    return;
  }
  if (anyFieldFilled() || state.tokens.invite || state.tokens.setup) return;
  try {
    const me = normSession(await api('GET', '/api/me'));
    if (me && !state.me && !anyFieldFilled()) onAuthenticated(me, false, { silent: true });
  } catch { /* cicho — to tylko odświeżenie w tle */ }
}

function bindGlobal() {
  window.addEventListener('hashchange', onHashChange);
  d.addEventListener('visibilitychange', onVisible);
  window.addEventListener('beforeunload', e => {
    if (state.letterDirty) { e.preventDefault(); e.returnValue = ''; }
  });
  d.getElementById('logout-btn').addEventListener('click', e => logout(e.currentTarget));
  $('.skip-link').addEventListener('click', e => { e.preventDefault(); focusHeading(); });
}

// ---------- Start ----------

function viewBootError(err) {
  const retry = h('button', { type: 'button', class: 'btn btn--ink' }, icon('refresh'), 'Spróbuj ponownie');
  retry.addEventListener('click', () => { mainEl().replaceChildren(viewLoading()); boot(); });
  return h('section', { class: 'state container' },
    art('empty-letter'),
    h('h1', { class: 'state__title', tabindex: '-1', text: 'Nie możemy połączyć się z Mikołajem' }),
    h('p', { class: 'state__text', text: messageOf(err) }),
    h('div', { class: 'state__actions' }, retry));
}

async function boot() {
  state.booting = true;
  const link = readLinkFragment();
  try {
    const me = normSession(await api('GET', '/api/me'));
    if (me) {
      if (link) {
        state.pendingLink = link.token ? link : null;
        clearFragment();
      }
      state.me = me;
      renderApp();
    } else {
      applyLink(link);
      renderWelcome();
      if (state.tokens.invite) checkInvitation();
    }
  } catch (err) {
    showShell(false);
    mainEl().replaceChildren(viewBootError(err));
  } finally {
    state.booting = false;
  }
}

bindGlobal();
boot();
