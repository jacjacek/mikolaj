/* Mikołaj — tryb podglądu UX bez logowania.
   Moduł ES bez zależności. Lokalna, przykładowa rodzina zamiast prawdziwego API:
   nie wysyła żadnych żądań sieciowych, nie zna prawdziwych kont ani sesji
   i zapisuje wyłącznie własny klucz localStorage. Reguły odwzorowują backend
   (src/worker.js), żeby istniejąca obsługa błędów w app.js działała bez zmian. */

export const DEMO_STORAGE_KEY = 'mikolaj.ux-demo.v1';
const SCHEMA = 1;
const FIRST_ID = 'demo-ania';
const MAX_BODY = 16000;
const MAX_WISHES = 200;

// ---------- Tryb ----------

// Domyślnie podgląd. Prawdziwa aplikacja: ?live=1 albo otwarty link #setup= / #invite=.
function detectDemo() {
  try {
    if (new URLSearchParams(location.search).get('live') === '1') return false;
    const raw = location.hash.slice(1);
    if (raw && !raw.startsWith('/')) {
      const params = new URLSearchParams(raw);
      if (params.has('invite') || params.has('setup')) return false;
    }
    return true;
  } catch { return false; }
}

export const DEMO = detectDemo();

export class DemoError extends Error {
  constructor(status, message) { super(message); this.name = 'DemoError'; this.status = status; }
}
const fail = (status, message) => { throw new DemoError(status, message); };

// ---------- Dane przykładowe (fikcyjne) ----------

const MEMBER_IDS = Object.freeze(['demo-ania', 'demo-bartek', 'demo-marta', 'demo-tomek']);

function seed() {
  const members = [
    { id: 'demo-ania', name: 'Ania', letter: 'w tym roku dużo czytam i uczę się piec chleb na zakwasie. Najbardziej ucieszy mnie coś, co przyda się w kuchni albo wyciągnie mnie z domu. Noszę rozmiar M. Proszę — żadnych świeczek zapachowych!' },
    { id: 'demo-bartek', name: 'Bartek', letter: 'piszę krótko, bo wolę rower niż pisanie listów. Jeżdżę do pracy cały rok, więc przyda mi się wszystko, co pomaga zimą. Kubków mam już naprawdę dość.' },
    { id: 'demo-marta', name: 'Marta', letter: 'chciałabym w nowym roku znaleźć więcej czasu na rysowanie. Lubię ciepłe kolory i rzeczy robione ręcznie. Świeczek i kubków mam pod dostatkiem.' },
    { id: 'demo-tomek', name: 'Tomek', letter: 'byłem w tym roku grzeczny (prawie zawsze). Lubię klocki, kosmos i dinozaury. Nie lubię swetrów, które drapią.' },
  ];
  let n = 0;
  const wish = (ownerId, title, note, url, price) => {
    n++;
    return { id: `demo-w-${String(n).padStart(2, '0')}`, ownerId, title, note, url, price, createdAt: `2026-11-01T10:${String(n).padStart(2, '0')}:00.000Z` };
  };
  const wishes = [
    wish('demo-ania', 'Książka o pieczeniu chleba', 'Dla początkujących, najlepiej z przepisami na zakwas.', 'https://www.empik.com/', 89),
    wish('demo-ania', 'Ciepłe skarpety wełniane', 'Rozmiar 38–40, kolor dowolny, byle nie różowy.', '', 45),
    wish('demo-ania', 'Koszyk do wyrastania chleba', 'Okrągły, około 22 cm średnicy.', 'https://allegro.pl/', 59.9),
    wish('demo-ania', 'Bilety do teatru', 'Dowolny spektakl — chętnie we dwoje.', '', null),
    wish('demo-bartek', 'Tylna lampka rowerowa', 'Ładowana przez USB, z trybem migania.', 'https://www.decathlon.pl/', 79),
    wish('demo-bartek', 'Zimowe rękawiczki rowerowe', 'Rozmiar L, z palcami do ekranu dotykowego.', '', 119),
    wish('demo-bartek', 'Gra planszowa dla dwóch osób', 'Coś krótkiego, do 30 minut rozgrywki.', '', 120),
    wish('demo-bartek', 'Kalendarz ścienny ze zdjęciami gór', '', '', 39.99),
    wish('demo-marta', 'Zestaw akwareli w kostkach', '24 kolory, najlepiej w metalowym pudełku.', 'https://www.empik.com/', 149),
    wish('demo-marta', 'Szkicownik A5 z grubym papierem', 'Papier co najmniej 200 g/m².', '', 35),
    wish('demo-marta', 'Roślina doniczkowa do jasnego pokoju', 'Coś łatwego w pielęgnacji.', '', null),
    wish('demo-tomek', 'Klocki — stacja kosmiczna', 'Dla 8+, marka dowolna. Najlepiej z astronautami.', 'https://allegro.pl/', 199),
    wish('demo-tomek', 'Latarka czołowa', 'Do czytania pod kołdrą.', '', 49),
    wish('demo-tomek', 'Książka o dinozaurach', 'Z dużymi ilustracjami.', 'https://www.empik.com/', 59),
    wish('demo-tomek', 'Puzzle 500 elementów z mapą nieba', '', '', 69),
  ];
  const byId = Object.fromEntries(wishes.map(w => [w.id, w]));
  const snap = w => ({ title: w.title, note: w.note, url: w.url, price: w.price });
  const reservation = (wishId, memberId, purchased, snapshot = snap(byId[wishId])) => ({ wishId, memberId, purchased, snapshot });
  const reservations = [
    // Ania: jeden prezent kupiony, drugi zmieniony przez autora po rezerwacji.
    reservation('demo-w-05', 'demo-ania', true),
    reservation('demo-w-12', 'demo-ania', false, { ...snap(byId['demo-w-12']), note: 'Dla 8+, marka dowolna.', price: 179 }),
    // Pozostali — z perspektywy Ani: „Ktoś już to szykuje” / „Ktoś już to kupił”.
    reservation('demo-w-06', 'demo-tomek', false),
    reservation('demo-w-10', 'demo-bartek', true),
    reservation('demo-w-14', 'demo-marta', false),
    // Na liście Ani — Ania tego nie widzi, Bartek i Tomek zobaczą „Zajęte”.
    reservation('demo-w-01', 'demo-bartek', true),
    reservation('demo-w-02', 'demo-marta', false),
  ];
  return { schema: SCHEMA, activeId: FIRST_ID, family: { id: 'demo-family', name: 'Przykładowa rodzina' }, members, wishes, reservations, seq: wishes.length };
}

// ---------- Walidacja (jak w backendzie) ----------

const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v, max, required = false) => typeof v === 'string' && v.length <= max && (!required || v.trim().length > 0);
const isPrice = v => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1000000);

function isSafeUrl(value) {
  if (value === '') return true;
  if (!isText(value, 2000)) return false;
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
  } catch { return false; }
}

const isWishFields = w => isPlain(w) && isText(w.title, 160, true) && isText(w.note, 1500) && isSafeUrl(w.url) && isPrice(w.price);

function isValidState(s) {
  if (!isPlain(s) || s.schema !== SCHEMA || !Number.isSafeInteger(s.seq) || s.seq < 0) return false;
  if (!isPlain(s.family) || !isText(s.family.id, 128, true) || !isText(s.family.name, 80, true)) return false;
  if (!Array.isArray(s.members) || !Array.isArray(s.wishes) || !Array.isArray(s.reservations)) return false;
  if (s.members.length !== MEMBER_IDS.length) return false;
  const members = new Set();
  for (const m of s.members) {
    if (!isPlain(m) || !MEMBER_IDS.includes(m.id) || members.has(m.id) || !isText(m.name, 60, true) || !isText(m.letter, 4000)) return false;
    members.add(m.id);
  }
  const owners = new Map();
  const perOwner = new Map();
  for (const w of s.wishes) {
    if (!isWishFields(w) || !isText(w.id, 128, true) || owners.has(w.id) || !members.has(w.ownerId) || !isText(w.createdAt, 40, true)) return false;
    owners.set(w.id, w.ownerId);
    perOwner.set(w.ownerId, (perOwner.get(w.ownerId) || 0) + 1);
    if (perOwner.get(w.ownerId) > MAX_WISHES) return false;
  }
  const reserved = new Set();
  for (const r of s.reservations) {
    if (!isPlain(r) || !owners.has(r.wishId) || reserved.has(r.wishId) || !members.has(r.memberId)) return false;
    if (owners.get(r.wishId) === r.memberId || typeof r.purchased !== 'boolean' || !isWishFields(r.snapshot)) return false;
    reserved.add(r.wishId);
  }
  return true;
}

function text(value, label, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `Sprawdź pole „${label}” (maks. ${max} znaków).`);
  return value.trim();
}

function wishFields(body) {
  const title = text(body.title, 'Nazwa prezentu', 160, true);
  const note = text(body.note ?? '', 'Wskazówki', 1500);
  let url = text(body.url ?? '', 'Link', 2000);
  if (url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      url = parsed.href;
    } catch { fail(400, 'Link musi zaczynać się od https:// lub http:// i nie zawierać danych logowania.'); }
  }
  let price = body.price;
  if (price === '' || price === undefined) price = null;
  if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1000000)) fail(400, 'Podaj cenę od 0 do 1 000 000 zł lub zostaw puste pole.');
  if (price !== null) price = Math.round(price * 100) / 100;
  return { title, note, url, price };
}

// ---------- Przechowywanie ----------

let db = null;
let persistent = false;
let recovered = false;
const listeners = new Set();

function storage() {
  try { return window.localStorage || null; } catch { return null; }
}

function commit() {
  if (!persistent) return;
  try {
    storage().setItem(DEMO_STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Brak miejsca albo zablokowana pamięć: zostajemy przy stanie w tej karcie.
    persistent = false;
    for (const cb of listeners) { try { cb(demoStatus()); } catch { /* widok sam się odświeży */ } }
  }
}

function load() {
  const ls = storage();
  let raw = null;
  let readable = Boolean(ls);
  if (ls) {
    try { raw = ls.getItem(DEMO_STORAGE_KEY); } catch { readable = false; }
  }
  let parsed = null;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (parsed && isValidState(parsed)) {
    db = parsed;
  } else {
    db = seed();
    recovered = raw !== null;
  }
  if (!db.members.some(m => m.id === db.activeId)) db.activeId = FIRST_ID;
  persistent = readable;
  commit();
}

// ---------- Interfejs dla UI ----------

export function initDemo() {
  if (!db) load();
  return demoStatus();
}

export const demoStatus = () => ({ persistent, recovered });

export function onDemoStatus(cb) {
  if (typeof cb === 'function') listeners.add(cb);
}

export function demoPeople() {
  if (!db) return [];
  return db.members.map(m => ({ id: m.id, name: m.name }));
}

export const demoActiveId = () => (db ? db.activeId : FIRST_ID);

export function setDemoActive(id) {
  if (!db || !db.members.some(m => m.id === id)) return false;
  db.activeId = id;
  commit();
  return true;
}

export function resetDemo() {
  // Usuwa tylko własny klucz podglądu; inne wpisy localStorage zostają nietknięte.
  db = seed();
  recovered = false;
  commit();
}

// ---------- Lokalne API ----------

const memberById = id => db.members.find(m => m.id === id);
const wishById = id => db.wishes.find(w => w.id === id);
const reservationFor = wishId => db.reservations.find(r => r.wishId === wishId);
const byCreated = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byName = (a, b) => a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' });
const publicWish = w => ({ id: w.id, ownerId: w.ownerId, title: w.title, note: w.note, url: w.url, price: w.price, createdAt: w.createdAt });
const changedSince = (original, w) => ['title', 'note', 'url', 'price'].some(field => original[field] !== w[field]);

function decodeId(raw) {
  try { return decodeURIComponent(raw); } catch { return fail(404, 'Nie znaleziono tej strony.'); }
}

function session(me) {
  const members = db.members.map(m => ({
    id: m.id, name: m.name, letter: m.letter,
    wishCount: db.wishes.filter(w => w.ownerId === m.id).length,
  })).sort(byName);
  // Podgląd nie ma kont: bez e-maila i bez uprawnień organizatora.
  return { user: { id: me.id, name: me.name, email: '', isAdmin: false }, family: { ...db.family }, members };
}

function route(method, path, body) {
  const me = memberById(db.activeId);
  if (!me) fail(500, 'Dane podglądu są niespójne. Użyj „Od nowa”.');

  if (method === 'GET' && path === '/api/me') return session(me);

  if (['/api/login', '/api/create', '/api/join', '/api/logout', '/api/invite'].includes(path) || path.startsWith('/api/invitation/')) {
    fail(403, 'W podglądzie UX logowanie i zaproszenia są wyłączone — to tylko dane przykładowe.');
  }

  if (path === '/api/letter') {
    if (method !== 'PATCH') fail(405, 'Ta operacja nie jest obsługiwana.');
    me.letter = text(body.letter, 'List', 4000);
    commit();
    return { ok: true };
  }

  const listMatch = path.match(/^\/api\/members\/([^/]+)\/wishes$/);
  if (listMatch) {
    if (method !== 'GET') fail(405, 'Ta operacja nie jest obsługiwana.');
    const owner = memberById(decodeId(listMatch[1]));
    if (!owner) fail(404, 'Nie znaleziono listu.');
    const own = db.wishes.filter(w => w.ownerId === owner.id).sort(byCreated);
    // Na własnej liście w ogóle nie sięgamy do rezerwacji.
    const wishes = owner.id === me.id
      ? own.map(publicWish)
      : own.map(w => {
        const r = reservationFor(w.id);
        const mine = Boolean(r) && r.memberId === me.id;
        return {
          ...publicWish(w), reserved: Boolean(r), reservedByMe: mine, purchased: Boolean(r && r.purchased),
          ...(mine ? { changedSinceReservation: changedSince(r.snapshot, w) } : {}),
        };
      });
    return { member: { id: owner.id, name: owner.name, letter: owner.letter }, wishes };
  }

  if (path === '/api/reservations') {
    if (method !== 'GET') fail(405, 'Ta operacja nie jest obsługiwana.');
    const wishes = db.reservations
      .filter(r => r.memberId === me.id)
      .map(r => ({ r, w: wishById(r.wishId) }))
      .filter(({ w }) => w)
      .sort((a, b) => byName(memberById(a.w.ownerId), memberById(b.w.ownerId)) || byCreated(a.w, b.w))
      .map(({ r, w }) => ({
        ...publicWish(w), ...r.snapshot,
        ownerName: memberById(w.ownerId).name, purchased: r.purchased, changedSinceReservation: changedSince(r.snapshot, w),
      }));
    return { wishes };
  }

  if (path === '/api/wishes') {
    if (method !== 'POST') fail(405, 'Ta operacja nie jest obsługiwana.');
    const w = wishFields(body);
    if (db.wishes.filter(x => x.ownerId === me.id).length >= MAX_WISHES) fail(409, `Twój list może mieć najwyżej ${MAX_WISHES} życzeń.`);
    db.seq += 1;
    const id = `demo-w-${db.seq.toString(36)}-${Date.now().toString(36)}`;
    db.wishes.push({ id, ownerId: me.id, ...w, createdAt: new Date().toISOString() });
    commit();
    return { id };
  }

  const match = path.match(/^\/api\/wishes\/([^/]+)(\/reserve)?$/);
  if (match) {
    const w = wishById(decodeId(match[1]));
    if (!w) fail(404, 'To życzenie nie jest już dostępne.');
    if (!match[2]) {
      if (method !== 'PATCH' && method !== 'DELETE') fail(405, 'Ta operacja nie jest obsługiwana.');
      if (w.ownerId !== me.id) fail(403, 'Możesz zmieniać tylko swój list.');
      if (method === 'PATCH') {
        Object.assign(w, wishFields(body));
        commit();
        return { ok: true };
      }
      db.reservations = db.reservations.filter(r => r.wishId !== w.id);
      db.wishes = db.wishes.filter(x => x.id !== w.id);
      commit();
      return { ok: true };
    }
    if (!['POST', 'PATCH', 'DELETE'].includes(method)) fail(405, 'Ta operacja nie jest obsługiwana.');
    if (w.ownerId === me.id) fail(403, 'Nie można rezerwować własnych życzeń.');
    const reservation = reservationFor(w.id);
    if (method === 'POST') {
      if (reservation) fail(409, 'Ktoś już zarezerwował ten prezent. Wybierz inne życzenie.');
      db.reservations.push({ wishId: w.id, memberId: me.id, purchased: false, snapshot: { title: w.title, note: w.note, url: w.url, price: w.price } });
      commit();
      return { ok: true };
    }
    if (!reservation || reservation.memberId !== me.id) fail(403, 'Możesz zmieniać tylko swoje rezerwacje.');
    if (method === 'DELETE') {
      db.reservations = db.reservations.filter(r => r !== reservation);
      commit();
      return { ok: true };
    }
    if (typeof body.purchased !== 'boolean') fail(400, 'Niepoprawny status prezentu.');
    reservation.purchased = body.purchased;
    commit();
    return { ok: true };
  }

  fail(404, 'Nie znaleziono tej strony.');
}

export async function demoRequest(method, path, body) {
  if (!db) fail(503, 'Podgląd nie jest gotowy. Odśwież stronę.');
  const verb = String(method).toUpperCase();
  const target = String(path).split(/[?#]/)[0];
  let input = {};
  if (verb !== 'GET' && verb !== 'HEAD' && verb !== 'DELETE') {
    let raw;
    try { raw = JSON.stringify(body === undefined ? null : body); } catch { fail(400, 'Niepoprawny formularz. Odśwież stronę i spróbuj ponownie.'); }
    if (raw.length > MAX_BODY) fail(413, 'Przesłany formularz jest za duży.');
    input = JSON.parse(raw);
    if (!isPlain(input)) fail(400, 'Niepoprawny formularz.');
  }
  // Odpowiedź jest kopią — widok nie może przypadkiem zmienić stanu podglądu.
  return JSON.parse(JSON.stringify(route(verb, target, input)));
}
