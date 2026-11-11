/* Mikołaj — rodzinne listy życzeń.
   Moduł ES bez zależności. Dane użytkowników trafiają do DOM wyłącznie
   przez textContent, .value lub setAttribute — nigdy przez innerHTML. */

import { DEMO, DemoError, initDemo, demoRequest, demoPeople, demoActiveId, setDemoActive, resetDemo, onDemoStatus } from './demo.js';

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
const capFirst = t => (t ? t.charAt(0).toLocaleUpperCase('pl-PL') + t.slice(1) : t);
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
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
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
  if (DEMO) {
    // Podgląd UX: lokalne dane przykładowe, bez żadnego żądania do serwera.
    inflight++;
    try {
      const data = await demoRequest(method, path, body);
      if (!isObj(data)) throw new ApiError(UNEXPECTED);
      return data;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof DemoError) throw new ApiError(err.message || statusMessage(err.status), err.status);
      throw new ApiError('Podgląd napotkał błąd. Odśwież stronę albo przywróć dane przykładowe.');
    } finally {
      inflight--;
    }
  }
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
  memberFilter: 'all',
  lastVisibleRefresh: 0,
  booting: true,
  appHash: '',
};
let letterNode = null;
const letterDisclosureState = new Map();

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
  const t = raw.replace(/[\s ]/g, '').replace(/(zł|zl|pln)$/i, '').replace(',', '.');
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
  d.title = 'Mikołaj — rodzinne listy życzeń';
  mainEl().replaceChildren(viewWelcome());
}

function viewWelcome() {
  const card = h('div', { class: 'auth-card', id: 'auth-card' });
  renderAuthCard(card);
  const fact = (name, text) => h('li', null, icon(name, 'icon icon--sm'), h('span', { text }));

  return h('div', { class: 'welcome container' },
    h('div', { class: 'welcome__brand' }, h('span', { class: 'brand__name', text: 'Mikołaj' })),
    h('div', { class: 'welcome__grid' },
      h('section', { class: 'welcome__intro' },
        h('h1', { class: 'display', tabindex: '-1', text: 'Rodzinne listy życzeń.' }),
        h('p', { class: 'lede', text: 'Każdy pisze swój list i dodaje życzenia. Bliscy po cichu rezerwują prezenty — bez dublowania i bez psucia niespodzianek.' }),
        h('ul', { class: 'facts', role: 'list' },
          fact('lock', 'Dostęp mają tylko osoby zaproszone do rodziny.'),
          fact('gift', 'Jeden prezent — jedna rezerwacja.'),
          fact('eye-off', 'Na własnej liście nie widzisz rezerwacji.'))),
      h('div', { class: 'welcome__panel' }, card)),
    h('footer', { class: 'site-foot', text: 'E-mail służy tylko do logowania. Nie wysyłamy żadnych wiadomości.' }));
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
            h('p', { text: 'Link mógł zostać zmieniony. Poproś osobę, która prowadzi Waszą rodzinę, o aktualny link. Jeśli masz już konto — zaloguj się.' }))),
        authHead('Zaloguj się', null),
        loginForm());
    } else {
      if (inv.status === 'error') {
        const retry = h('button', { type: 'button', class: 'btn btn--secondary btn--sm' }, icon('refresh', 'icon icon--sm'), 'Sprawdź ponownie');
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
        parts.push(authHead('Zaloguj się', 'Masz już konto w tej rodzinie? Użyj tego samego adresu e-mail.'), loginForm());
      }
    }
  } else if (tokens.setup) {
    parts.push(segmented([{ value: 'create', label: 'Załóż rodzinę' }, { value: 'login', label: 'Mam już konto' }], auth.mode, onMode));
    if (auth.mode === 'create') {
      parts.push(authHead('Załóż rodzinę', 'Ten prywatny link pozwala utworzyć rodzinę. Dostaniesz link zaproszenia dla bliskich.'), createForm());
    } else {
      parts.push(authHead('Zaloguj się', null), loginForm());
    }
  } else {
    parts.push(authHead('Zaloguj się', null), loginForm());
    parts.push(h('div', { class: 'auth-card__foot' },
      h('strong', { text: 'Nie masz konta?' }),
      h('p', { text: 'Konto zakłada się wyłącznie z prywatnego linku zaproszenia. Poproś o niego osobę, która prowadzi Waszą rodzinę.' })));
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
      name: field({ label: 'Twoje imię', name: 'name', required: true, maxlength: LIMITS.name, autocomplete: 'given-name', placeholder: 'np. Ania', hint: 'Tak zobaczą Cię bliscy.' }),
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
    ? `Witaj w rodzinie „${me.family.name}”. Zacznij od swojego listu.`
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

// ---------- Powłoka aplikacji ----------

function showShell(on) {
  d.getElementById('topbar').hidden = !on;
  d.body.classList.toggle('is-authed', on);
  if (!on) d.getElementById('notice').replaceChildren();
}

function renderShell() {
  if (!state.me) return;
  const { user } = state.me;
  showShell(true);
  // W podglądzie imię aktywnej osoby pokazuje wyłącznie lista wyboru.
  d.getElementById('session').hidden = DEMO;
  d.getElementById('session-name').textContent = user.name;
  d.getElementById('logout-btn').setAttribute('aria-label', `Wyloguj się (${user.name})`);
  if (!DEMO) d.getElementById('brand-family').hidden = true;
  d.querySelector('[data-nav="invite"]').hidden = DEMO || !user.isAdmin;
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
  if (DEMO || !link || !state.me) { slot.replaceChildren(); return; }
  const what = link.kind === 'invite' ? 'link zaproszenia do rodziny' : 'link do założenia nowej rodziny';
  const leave = h('button', { type: 'button', class: 'btn btn--primary btn--sm' }, 'Wyloguj się i użyj linku');
  const stay = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Zignoruj');
  leave.addEventListener('click', () => logout(leave, link));
  stay.addEventListener('click', () => { state.pendingLink = null; renderPendingNotice(); focusHeading(); });
  slot.replaceChildren(h('div', { class: 'container' },
    h('div', { class: 'banner', role: 'region', 'aria-label': 'Otwarty link' },
      h('p', { class: 'banner__text', text: `Otwarto ${what}, ale masz otwartą sesję jako ${state.me.user.name} (${state.me.family.name}). Aby go użyć, najpierw się wyloguj.` }),
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
  home: { title: () => 'Listy bliskich', render: () => viewHome() },
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
    title: () => 'Moje prezenty',
    load: async () => normReservations(await api('GET', '/api/reservations')),
    render: data => viewReservations(data),
  },
  invite: { title: () => 'Zaproś bliskich', render: () => viewInvite() },
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
    state.memberFilter = 'all';
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

async function act(btn, call, { success } = {}) {
  if (!btn || btn.disabled) return;
  setBusy(btn, true);
  try {
    await call();
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
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: label }));
}

function stateView(title, text, actions) {
  return h('section', { class: 'state container' },
    h('h1', { class: 'page-title', tabindex: '-1', text: title }),
    h('p', { class: 'state__text', text }),
    h('div', { class: 'state__actions' }, actions));
}

function viewError(err, retry, withBack = false) {
  const retryBtn = h('button', { type: 'button', class: 'btn btn--primary' }, icon('refresh', 'icon icon--sm'), 'Spróbuj ponownie');
  retryBtn.addEventListener('click', retry);
  return stateView('Nie udało się wczytać', messageOf(err),
    [retryBtn, withBack ? h('a', { class: 'btn btn--secondary', href: '#/' }, 'Listy bliskich') : null]);
}

function viewNotFound() {
  return stateView('Tej strony tu nie ma', 'Może adres się zmienił.', [h('a', { class: 'btn btn--primary', href: '#/' }, 'Listy bliskich')]);
}

function quiet(iconName, text) {
  return [icon(iconName, 'icon icon--sm'), h('span', { text })];
}

function pageHead({ title, meta, note, action, back }) {
  return h('header', { class: 'page-head' },
    back || null,
    h('div', { class: 'page-head__row' },
      h('div', { class: 'page-head__text' },
        h('h1', { class: 'page-title', tabindex: '-1', text: title }),
        meta ? h('p', { class: 'page-meta' }, meta) : null),
      action || null),
    note ? h('p', { class: 'page-note' }, note) : null);
}

function addWishButton(fkey) {
  const btn = h('button', { type: 'button', class: 'btn btn--primary btn--sm', 'data-fkey': fkey }, icon('plus', 'icon icon--sm'), 'Dodaj życzenie');
  btn.addEventListener('click', () => openWishDialog(null));
  return btn;
}

function sectionHead(id, title, n, action) {
  return h('div', { class: 'section-head' },
    h('h2', { class: 'section-title', id },
      title,
      n ? h('span', { class: 'section-count', text: String(n) }) : null),
    action || null);
}

// ---------- Listy bliskich ----------

function viewHome() {
  const { user, family, members } = state.me;
  const all = members.some(m => m.id === user.id) ? members : [...members, { id: user.id, name: user.name, letter: '', wishCount: 0 }];
  const people = [...all].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const alone = people.length < 2;

  let foot = null;
  if (alone) {
    foot = h('div', { class: 'empty' },
      h('p', { class: 'empty__text', text: user.isAdmin
        ? 'Na razie jesteś tu tylko Ty. Wyślij bliskim prywatny link zaproszenia.'
        : 'Na razie jesteś tu tylko Ty. Listy bliskich pojawią się, gdy dołączą.' }),
      user.isAdmin ? h('a', { class: 'btn btn--secondary btn--sm', href: '#/zaproszenie' }, icon('link', 'icon icon--sm'), 'Zaproś bliskich') : null);
  } else if (user.isAdmin) {
    foot = h('p', { class: 'page-foot' }, h('a', { class: 'text-link', href: '#/zaproszenie' }, icon('plus', 'icon icon--sm'), 'Zaproś kolejną osobę'));
  }

  return h('div', { class: 'page container' },
    pageHead({
      title: 'Listy bliskich',
      meta: `${family.name} · ${count(people.length, FORMS.person)}`,
      action: addWishButton('home-add'),
    }),
    h('ul', { class: 'people', role: 'list' }, people.map(m => h('li', null, personCard(m, m.id === user.id)))),
    foot);
}

function personCard(m, self) {
  const text = snippet(m.letter, 160);
  return h('a', {
    class: `person${self ? ' person--self' : ''}`,
    href: self ? '#/moja-lista' : `#/osoba/${encodeURIComponent(m.id)}`,
    'data-fkey': `person-${m.id}`,
  },
  h('span', { class: 'person__head' },
    h('span', { class: 'person__name', text: m.name }),
    self ? h('span', { class: 'tag tag--accent', text: 'Twój list' }) : null),
  h('span', {
    class: `person__preview${text ? '' : ' is-empty'}`,
    text: text ? capFirst(text) : (self ? 'Nie masz jeszcze listu.' : 'Bez listu.'),
  }),
  h('span', { class: 'person__meta' },
    h('span', { text: m.wishCount ? count(m.wishCount, FORMS.wish) : 'Brak życzeń' }),
    icon('arrow-right', 'icon icon--sm person__arrow')));
}

// ---------- List: treść ----------

function letterBody(text) {
  const id = uid('letter');
  const body = h('div', { class: 'letter__body', id },
    h('p', { class: 'letter__salutation', text: 'Drogi Mikołaju,' }),
    h('p', { class: 'letter__text', text }));
  const long = text.length > 260 || text.split('\n').length > 5;
  if (!long) return body;
  body.classList.add('is-clamped');
  const more = h('button', { type: 'button', class: 'text-btn', 'aria-expanded': 'false', 'aria-controls': id }, 'Czytaj całość');
  more.addEventListener('click', () => {
    const open = !body.classList.toggle('is-clamped');
    more.setAttribute('aria-expanded', String(open));
    more.textContent = open ? 'Zwiń' : 'Czytaj całość';
  });
  return h('div', null, body, more);
}

// ---------- Mój list ----------

function viewMine({ member, wishes }) {
  const editor = state.editingLetter && letterNode ? letterNode : (letterNode = letterEditor(member.letter));
  const list = wishes.length
    ? h('ul', { class: 'wishes', role: 'list' }, wishes.map(w => h('li', null, ownWishCard(w))))
    : h('p', { class: 'empty__text', text: 'Lista jest pusta. Życzenie może być konkretne — z linkiem i ceną — albo ogólne, np. „dobra książka o górach”.' });

  return h('div', { class: 'page page--narrow container' },
    pageHead({ title: 'Mój list', meta: quiet('eye-off', 'Rodzina widzi Twój list. Rezerwacji tu nie zobaczysz.') }),
    editor,
    h('section', { class: 'section', 'aria-labelledby': 'wishes-h' },
      sectionHead('wishes-h', 'Życzenia', wishes.length, addWishButton('add-wish')),
      list));
}

function letterEditor(initialText) {
  let saved = initialText;
  const root = h('section', { class: 'letter', 'aria-labelledby': 'letter-h' });

  const show = () => {
    state.editingLetter = false;
    state.letterDirty = false;
    const has = saved.trim().length > 0;
    const editBtn = h('button', {
      type: 'button', class: 'btn btn--ghost btn--sm', 'data-fkey': 'letter-edit',
      'aria-label': has ? 'Edytuj list' : 'Napisz list',
    }, icon('edit', 'icon icon--sm'), has ? 'Edytuj' : 'Napisz');
    editBtn.addEventListener('click', edit);
    root.replaceChildren(
      sectionHead('letter-h', 'List', 0, editBtn),
      has
        ? letterBody(saved)
        : h('p', { class: 'empty__text', text: 'Napisz kilka słów: co Cię cieszy, jaki nosisz rozmiar, czego na pewno nie chcesz.' }));
  };

  const edit = () => {
    state.editingLetter = true;
    letterNode = root;
    const alert = formAlert();
    const textarea = h('textarea', {
      id: 'letter-input', class: 'input letter__input', maxlength: LIMITS.letter, rows: 7,
      placeholder: 'Piszę, bo…', 'aria-describedby': 'letter-count',
    });
    textarea.value = saved;
    const counter = h('p', { id: 'letter-count', class: 'field__hint' });
    const save = h('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Zapisz list');
    const cancel = h('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Anuluj');
    const update = () => {
      counter.textContent = `${textarea.value.length} / ${LIMITS.letter} · Ctrl + Enter zapisuje`;
      state.letterDirty = textarea.value !== saved;
    };
    const finish = () => { show(); $('[data-fkey="letter-edit"]', root)?.focus(); };
    let busy = false;

    const form = h('form', { class: 'letter__form', novalidate: true },
      h('p', { class: 'letter__salutation', 'aria-hidden': 'true', text: 'Drogi Mikołaju,' }),
      h('label', { class: 'sr-only', for: 'letter-input', text: 'Treść listu' }),
      textarea,
      counter,
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
    root.replaceChildren(sectionHead('letter-h', 'List', 0, null), form);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  };

  show();
  return root;
}

function wishCardBase(w, extraClass = '') {
  const titleId = uid('w');
  return h('article', { class: `wish${extraClass ? ` ${extraClass}` : ''}`, 'aria-labelledby': titleId },
    h('div', { class: 'wish__head' },
      h('h3', { class: 'wish__title', id: titleId, text: w.title }),
      w.price !== null ? h('p', { class: 'wish__price' }, h('span', { class: 'sr-only', text: 'Cena: ' }), formatPrice(w.price)) : null),
    w.note ? h('p', { class: 'wish__note', text: w.note }) : null,
    w.url ? h('a', { class: 'wish__link', href: w.url, target: '_blank', rel: 'noopener noreferrer' },
      h('span', { text: displayHost(w.url) }),
      icon('external', 'icon icon--xs'),
      h('span', { class: 'sr-only', text: ' (otwiera się w nowej karcie)' })) : null);
}

function ownWishCard(w) {
  const card = wishCardBase(w);
  const edit = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', 'data-fkey': `edit-${w.id}`, 'aria-label': `Edytuj: ${w.title}` }, 'Edytuj');
  const del = h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-fkey': `del-${w.id}`, 'aria-label': `Usuń: ${w.title}` }, 'Usuń');
  edit.addEventListener('click', () => openWishDialog(w));
  del.addEventListener('click', () => confirmAction({
    title: 'Usunąć życzenie?',
    message: `„${w.title}” zniknie z Twojej listy. Tej operacji nie można cofnąć.`,
    confirmLabel: 'Usuń',
    action: async () => {
      await api('DELETE', `/api/wishes/${encodeURIComponent(w.id)}`);
      await refreshView();
      toast('Życzenie usunięte.', { tone: 'success' });
    },
  }));
  card.append(h('div', { class: 'wish__foot' }, edit, del));
  return card;
}

function openWishDialog(existing) {
  const editing = Boolean(existing);
  const fTitle = field({ label: 'Czego sobie życzysz?', name: 'title', required: true, maxlength: LIMITS.title, value: existing?.title, placeholder: 'np. Wełniany szalik', autocomplete: 'off' });
  const fNote = field({ label: 'Notatka', name: 'note', multiline: true, rows: 3, optional: true, maxlength: LIMITS.note, value: existing?.note, hint: 'Rozmiar, kolor, wariant — co pomoże trafić.' });
  const fUrl = field({ label: 'Link', name: 'url', type: 'url', inputmode: 'url', optional: true, maxlength: LIMITS.url, value: existing?.url ?? '', placeholder: 'https://…', spellcheck: false, autocapitalize: 'none', autocomplete: 'off' });
  const fPrice = field({
    label: 'Cena', name: 'price', inputmode: 'decimal', optional: true, autocomplete: 'off', placeholder: 'np. 149,99',
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
      toast(editing ? 'Zapisano zmiany.' : `Dodano do Twojego listu: ${body.title}`, { tone: 'success' });
    },
  });
}

// ---------- List innej osoby ----------

function filterControl(options, get, set) {
  const group = h('div', { class: 'segmented segmented--sm', role: 'group', 'aria-label': 'Pokaż życzenia' });
  const sync = () => { for (const b of group.children) b.setAttribute('aria-pressed', String(b.value === get())); };
  for (const o of options) {
    const b = h('button', { type: 'button', class: 'segmented__btn', value: o.value, 'data-fkey': `filter-${o.value}` }, o.label);
    b.addEventListener('click', () => { if (get() !== o.value) { set(o.value); sync(); } });
    group.append(b);
  }
  sync();
  return group;
}

function memberLetter(member) {
  const disclosure = h('details', {
    class: 'letter letter--fold',
    open: letterDisclosureState.get(member.id) ?? matchMedia('(min-width: 801px)').matches,
  },
  h('summary', { class: 'letter__summary', 'data-fkey': 'member-letter' },
    h('h2', { class: 'section-title', text: 'List' }),
    h('span', { class: 'letter__read', text: 'Przeczytaj' }),
    icon('arrow-right', 'icon icon--sm')),
  h('div', { class: 'letter__body' },
    h('p', { class: 'letter__salutation', text: 'Drogi Mikołaju,' }),
    h('p', { class: 'letter__text', text: member.letter })));
  disclosure.addEventListener('toggle', () => {
    if (disclosure.isConnected) letterDisclosureState.set(member.id, disclosure.open);
  });
  return disclosure;
}

function viewMember({ member, wishes }) {
  const free = wishes.filter(w => !w.reserved).length;
  const takenByOthers = wishes.filter(w => w.reserved && !w.reservedByMe).length;
  const hasLetter = member.letter.trim().length > 0;

  // „Dostępne” ukrywa tylko prezenty zajęte przez innych; Twoje rezerwacje zostają widoczne.
  const slot = h('div', { class: 'wishes-slot' });
  const fill = () => {
    const items = state.memberFilter === 'free' ? wishes.filter(w => !w.reserved || w.reservedByMe) : wishes;
    slot.replaceChildren(items.length
      ? h('ul', { class: 'wishes', role: 'list' }, items.map(w => h('li', null, otherWishCard(w))))
      : h('p', { class: 'empty__text', text: wishes.length ? 'Wszystko z tej listy jest już zajęte.' : 'Na tej liście nie ma jeszcze życzeń.' }));
  };
  fill();
  const filter = takenByOthers
    ? filterControl([{ value: 'all', label: 'Wszystkie' }, { value: 'free', label: 'Dostępne' }],
      () => state.memberFilter, v => { state.memberFilter = v; fill(); })
    : null;

  return h('div', { class: 'page page--narrow container' },
    pageHead({
      back: h('a', { class: 'back-link', href: '#/' }, icon('arrow-left', 'icon icon--sm'), 'Listy bliskich'),
      title: member.name,
      meta: wishes.length ? `${count(wishes.length, FORMS.wish)} · wolne: ${free}` : 'Brak życzeń',
      note: quiet('lock', `${member.name} nie widzi rezerwacji. Nie pokazujemy też, kto co zarezerwował.`),
    }),
    hasLetter ? memberLetter(member) : null,
    h('section', { class: 'section', 'aria-labelledby': 'wishes-h' },
      sectionHead('wishes-h', 'Życzenia', wishes.length, filter),
      slot));
}

function purchasedToggle(w) {
  const btn = h('button', {
    type: 'button', class: 'check', 'aria-pressed': String(w.purchased),
    'data-fkey': `buy-${w.id}`, 'aria-label': `Kupione: ${w.title}`,
  },
  h('span', { class: 'check__box', 'aria-hidden': 'true' }, icon('check', 'icon icon--xs')),
  h('span', { text: 'Kupione' }));
  btn.addEventListener('click', () => act(btn,
    () => api('PATCH', `/api/wishes/${encodeURIComponent(w.id)}/reserve`, { purchased: !w.purchased }),
    { success: w.purchased ? `Cofnięto oznaczenie zakupu: ${w.title}` : `Oznaczono jako kupione: ${w.title}` }));
  return btn;
}

function cancelReservationButton(w) {
  const btn = h('button', {
    type: 'button', class: 'btn btn--ghost btn--sm',
    'data-fkey': `cancel-${w.id}`, 'aria-label': `Zrezygnuj z rezerwacji: ${w.title}`,
  }, 'Zrezygnuj');
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

function changedNote(text, link) {
  return h('p', { class: 'inline-note', role: 'note' },
    icon('info', 'icon icon--sm'),
    h('span', null, text, link ? ' ' : null, link));
}

function otherWishCard(w) {
  if (!w.reserved) {
    const card = wishCardBase(w);
    const reserve = h('button', {
      type: 'button', class: 'btn btn--primary btn--sm',
      'data-fkey': `res-${w.id}`, 'aria-label': `Zarezerwuj: ${w.title}`,
    }, 'Zarezerwuj');
    reserve.addEventListener('click', () => act(reserve,
      () => api('POST', `/api/wishes/${encodeURIComponent(w.id)}/reserve`, {}),
      { success: `Zarezerwowano: ${w.title}. Nikt nie dowie się, że to Ty.` }));
    card.append(h('div', { class: 'wish__foot' }, reserve));
    return card;
  }
  if (w.reservedByMe) {
    // Zakup dotyczy wersji z chwili rezerwacji — nie przypisujemy go zmienionemu życzeniu.
    const changed = w.changedSinceReservation === true;
    const card = wishCardBase(w, 'wish--mine');
    if (changed) {
      card.append(changedNote('Zmienione po Twojej rezerwacji. Wersja z chwili rezerwacji i status zakupu są w zakładce',
        h('a', { class: 'text-link text-link--inline', href: '#/rezerwacje' }, 'Prezenty')));
    }
    card.append(h('div', { class: 'wish__foot' },
      h('span', { class: 'tag tag--accent wish__status', text: 'Twoja rezerwacja' }),
      changed ? null : purchasedToggle(w),
      cancelReservationButton(w)));
    return card;
  }
  const card = wishCardBase(w, 'wish--taken');
  card.append(h('div', { class: 'wish__foot' },
    h('span', { class: 'tag tag--muted wish__status', text: w.purchased ? 'Kupione' : 'Zajęte' })));
  return card;
}

// ---------- Moje prezenty ----------

function viewReservations(wishes) {
  const note = quiet('lock', 'Inni widzą tylko, że prezent jest zajęty — nie wiedzą, przez kogo.');
  if (!wishes.length) {
    return h('div', { class: 'page page--narrow container' },
      pageHead({ title: 'Moje prezenty', note }),
      h('div', { class: 'empty' },
        h('p', { class: 'empty__text', text: 'Nie masz jeszcze rezerwacji. Otwórz listę bliskiej osoby i wybierz prezent.' }),
        h('a', { class: 'btn btn--secondary btn--sm', href: '#/' }, 'Listy bliskich')));
  }

  const bought = wishes.filter(w => w.purchased).length;
  const priced = wishes.filter(w => w.price !== null);
  const sum = Math.round(priced.reduce((s, w) => s + w.price, 0) * 100) / 100;
  const unpriced = wishes.length - priced.length;
  let meta = `${count(wishes.length, FORMS.gift)} · kupione: ${bought} z ${wishes.length}`;
  if (priced.length) meta += ` · razem ${formatPrice(sum)}${unpriced ? ` (bez ceny: ${unpriced})` : ''}`;

  const groups = new Map();
  for (const w of wishes) {
    const key = w.ownerId || w.ownerName;
    if (!groups.has(key)) groups.set(key, { ownerId: w.ownerId, ownerName: w.ownerName, items: [] });
    groups.get(key).items.push(w);
  }

  const sections = [...groups.values()].map(g => {
    const headingId = uid('g');
    return h('section', { class: 'section', 'aria-labelledby': headingId },
      sectionHead(headingId, g.ownerName, g.items.length,
        g.ownerId ? h('a', { class: 'text-link', href: `#/osoba/${encodeURIComponent(g.ownerId)}` }, 'Otwórz list', h('span', { class: 'sr-only', text: `: ${g.ownerName}` })) : null),
      h('ul', { class: 'wishes', role: 'list' }, g.items.map(w => h('li', null, reservedWishCard(w)))));
  });

  return h('div', { class: 'page page--narrow container' },
    pageHead({ title: 'Moje prezenty', meta, note }),
    sections);
}

function reservedWishCard(w) {
  const card = wishCardBase(w, 'wish--mine');
  if (w.changedSinceReservation) {
    card.append(changedNote('Autor zmienił to życzenie. Tu widać wersję z chwili rezerwacji.',
      w.ownerId
        ? h('a', { class: 'text-link text-link--inline', href: `#/osoba/${encodeURIComponent(w.ownerId)}` },
          'Zobacz aktualną', h('span', { class: 'sr-only', text: `: ${w.ownerName}` }))
        : null));
  }
  card.append(h('div', { class: 'wish__foot' }, purchasedToggle(w), cancelReservationButton(w)));
  return card;
}

// ---------- Zaproszenia ----------

function viewInvite() {
  const { user, family } = state.me;
  const back = h('a', { class: 'btn btn--secondary btn--sm', href: '#/' }, 'Listy bliskich');
  if (DEMO) {
    return h('div', { class: 'page page--narrow container' },
      pageHead({ title: 'Zaproszenia', meta: 'W podglądzie zaproszenia są wyłączone — to przykładowa rodzina.' }), back);
  }
  if (!user.isAdmin) {
    return h('div', { class: 'page page--narrow container' },
      pageHead({ title: 'Zaproszenia', meta: 'Link zaproszenia udostępnia osoba, która założyła rodzinę. Poproś ją o link.' }), back);
  }

  const area = h('div', { class: 'invite__area' });
  renderInviteArea(area);

  const rotate = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', 'data-fkey': 'invite-rotate' }, icon('refresh', 'icon icon--sm'), 'Wygeneruj nowy link');
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

  return h('div', { class: 'page page--narrow container' },
    pageHead({ title: 'Zaproś bliskich', meta: `Osoba z linkiem może dołączyć do rodziny „${family.name}”.` }),
    h('section', { class: 'panel', 'aria-labelledby': 'invite-h' },
      h('h2', { class: 'section-title', id: 'invite-h', text: 'Link zaproszenia' }),
      h('p', { class: 'muted', text: 'Wyślij go tylko bliskim, SMS-em lub w komunikatorze. Mikołaj nie wysyła e-maili.' }),
      area),
    h('section', { class: 'panel panel--quiet', 'aria-labelledby': 'rotate-h' },
      h('h2', { class: 'section-title', id: 'rotate-h', text: 'Link trafił w niepowołane ręce?' }),
      h('p', { class: 'muted', text: 'Wygeneruj nowy. Poprzedni od razu przestanie działać; konta, które już dołączyły, zostaną.' }),
      h('div', null, rotate)));
}

function renderInviteArea(area) {
  if (!state.inviteUrl) {
    const alert = formAlert();
    const reveal = h('button', { type: 'button', class: 'btn btn--primary btn--sm', 'data-fkey': 'invite-reveal' }, icon('eye', 'icon icon--sm'), 'Pokaż link');
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

  const copy = h('button', { type: 'button', class: 'btn btn--primary', 'data-fkey': 'invite-copy' }, icon('copy', 'icon icon--sm'), h('span', { text: 'Kopiuj' }));
  let resetTimer = 0;
  copy.addEventListener('click', async () => {
    const ok = await copyText(url, input);
    if (ok) {
      copy.replaceChildren(icon('check', 'icon icon--sm'), h('span', { text: 'Skopiowano' }));
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { if (copy.isConnected) copy.replaceChildren(icon('copy', 'icon icon--sm'), h('span', { text: 'Kopiuj' })); }, 2200);
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
    h('p', { id: 'invite-url-hint', class: 'field__hint', text: 'Działa, dopóki nie wygenerujesz nowego.' }),
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
  if (DEMO && link) {
    // Prawdziwy link #setup= / #invite= otwiera chronioną aplikację; podgląd go nie obsługuje.
    location.reload();
    return;
  }
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
      message: 'Masz niezapisane zmiany w liście. Jeśli przejdziesz dalej, przepadną.',
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
  if (DEMO || anyFieldFilled() || state.tokens.invite || state.tokens.setup) return;
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

// ---------- Tryb podglądu UX ----------

let demoSelect = null;

const demoCueText = status => (status.persistent ? 'Podgląd · zapis lokalny' : 'Podgląd · tylko ta karta');
function demoNoteText(status) {
  return status.persistent
    ? 'Dane przykładowe. Zmiany zapisują się tylko w tej przeglądarce, bez synchronizacji — rodzina ich nie widzi.'
    : 'Dane przykładowe. Pamięć przeglądarki jest niedostępna: zmiany znikną po zamknięciu karty.';
}

// Narzędzia powstają raz, w nagłówku; odświeżanie widoków nie dotyka listy wyboru ani fokusu.
function mountDemoTools(status) {
  if (d.getElementById('demo-tools')) return false;
  const cue = d.getElementById('brand-family');
  cue.textContent = demoCueText(status);
  cue.hidden = false;

  const note = h('p', { class: 'demo__note', text: demoNoteText(status) });
  demoSelect = h('select', { id: 'demo-as', class: 'demo__select', name: 'demo-as' },
    demoPeople().map(p => h('option', { value: p.id, text: p.name })));
  demoSelect.value = demoActiveId();
  demoSelect.addEventListener('change', () => switchDemoPerson(demoSelect.value));

  const summary = h('summary', { class: 'icon-btn demo__toggle', 'aria-label': 'Podgląd: informacje i reset' }, icon('more'));
  const reset = h('button', { type: 'button', class: 'btn btn--secondary btn--sm btn--block' },
    icon('refresh', 'icon icon--sm'), 'Przywróć dane przykładowe');
  const menu = h('details', { class: 'demo__menu' }, summary,
    h('div', { class: 'demo__panel' },
      h('p', { class: 'demo__title', text: 'Podgląd bez logowania' }),
      note,
      reset));
  reset.addEventListener('click', () => { menu.open = false; summary.focus(); confirmDemoReset(); });
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu.open) { e.preventDefault(); menu.open = false; summary.focus(); }
  });
  d.addEventListener('click', e => { if (menu.open && !menu.contains(e.target)) menu.open = false; });

  onDemoStatus(next => {
    cue.textContent = demoCueText(next);
    const text = demoNoteText(next);
    if (note.textContent !== text) note.textContent = text;
    if (!next.persistent) toast('Nie udało się zapisać w pamięci przeglądarki. Zmiany zostają tylko w tej karcie.', { tone: 'error' });
  });

  d.getElementById('tools').prepend(h('div', { class: 'demo', id: 'demo-tools' },
    h('label', { class: 'demo__label', for: 'demo-as', text: 'Podgląd jako' }),
    demoSelect,
    menu));
  return true;
}

async function showDemoPerson(message) {
  state.editingLetter = false;
  state.letterDirty = false;
  state.inviteUrl = null;
  letterNode = null;
  const me = normSession(await api('GET', '/api/me'));
  if (!me) throw bad();
  state.me = me;
  if (demoSelect) demoSelect.value = me.user.id;
  if (location.hash !== '#/') history.pushState(null, '', '#/');
  // Fokus zostaje na liście wyboru; zmianę ogłasza powiadomienie.
  renderApp({ initial: true });
  toast(message(me), { tone: 'success' });
}

function switchDemoPerson(id) {
  const prev = demoActiveId();
  if (id === prev) return;
  const go = async () => {
    if (!setDemoActive(id)) throw new ApiError('Nie ma takiej osoby w danych przykładowych.', 404);
    await showDemoPerson(me => `Podgląd jako ${firstName(me.user.name)}.`);
  };
  if (state.letterDirty) {
    demoSelect.value = prev;
    const who = demoPeople().find(p => p.id === id)?.name || 'inną osobę';
    confirmAction({
      title: 'Porzucić zmiany w liście?',
      message: `Masz niezapisane zmiany w liście. Jeśli przełączysz podgląd na: ${who}, przepadną.`,
      confirmLabel: 'Porzuć i przełącz',
      action: go,
    });
    return;
  }
  go().catch(err => {
    demoSelect.value = demoActiveId();
    toast(messageOf(err), { tone: 'error' });
  });
}

function confirmDemoReset() {
  confirmAction({
    title: 'Przywrócić dane przykładowe?',
    message: `${state.letterDirty ? 'Masz niezapisane zmiany w liście — przepadną. ' : ''}Wszystkie zmiany w podglądzie w tej przeglądarce zostaną usunięte. Prawdziwych danych rodziny to nie dotyczy.`,
    confirmLabel: 'Przywróć',
    action: async () => {
      resetDemo();
      await showDemoPerson(() => 'Przywrócono dane przykładowe.');
    },
  });
}

async function bootDemo() {
  const status = initDemo();
  if (mountDemoTools(status) && status.recovered) {
    toast('Zapisane dane podglądu były uszkodzone — przywrócono dane przykładowe.', { tone: 'info' });
  }
  const me = normSession(await api('GET', '/api/me'));
  if (!me) throw bad();
  state.me = me;
  if (demoSelect) demoSelect.value = me.user.id;
  renderApp();
}

// ---------- Start ----------

function viewBootError(err) {
  const retry = h('button', { type: 'button', class: 'btn btn--primary' }, icon('refresh', 'icon icon--sm'), 'Spróbuj ponownie');
  retry.addEventListener('click', () => { mainEl().replaceChildren(viewLoading()); boot(); });
  return stateView('Nie udało się połączyć', messageOf(err), [retry]);
}

async function boot() {
  state.booting = true;
  if (DEMO) {
    try {
      await bootDemo();
    } catch (err) {
      showShell(false);
      mainEl().replaceChildren(viewBootError(err));
    } finally {
      state.booting = false;
    }
    return;
  }
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
