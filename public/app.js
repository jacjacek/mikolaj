/* Mikołaj — rodzinne listy do Mikołaja. Moduł bez zależności.
   Dane użytkowników trafiają do HTML wyłącznie przez esc(). */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pl = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? few : many;
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const daysToEve = () => { const n = new Date(); n.setHours(0, 0, 0, 0); let e = new Date(n.getFullYear(), 11, 24); if (n > e) e = new Date(n.getFullYear() + 1, 11, 24); return Math.round((e - n) / 864e5); };

// przedziały budżetowe — od najtańszego; porządkują listy
const TIERS = [
  { id: 'small', name: 'Drobnostki', range: 'do 50 zł' },
  { id: 'ok', name: 'Nie było niegrzecznie', range: '50–200 zł' },
  { id: 'good', name: 'To był grzeczny rok', range: '200–300 zł' },
  { id: 'angel', name: 'Byłem aniołkiem', range: 'bez limitu' },
];
const tier = id => TIERS.find(t => t.id === id) || TIERS[1];
const tierIx = w => TIERS.findIndex(t => t.id === w.tier);
const byTier = (list, render) => list.slice().sort((a, b) => tierIx(a) - tierIx(b)).map(render).join('');
const range = w => `<span class="st">${tier(w.tier).range}</span>`;

/* ===================== STAN ===================== */
const S = {
  data: null, admin: null, token: null,
  screen: 'lists',            // lists | mine | family | login | join | link
  open: new Set(),            // rozwinięte sekcje
  filter: {}, editWish: null, adding: null, editLetter: null, addingPerson: false,
  menu: false, fam: null, famView: 'for', confirm: null, info: null,
};
let theme = 'auto';
const isDark = () => theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
const SUN = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5"/></svg>';
const MOON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 12.6A7 7 0 0 1 7.4 3.5a7 7 0 1 0 9.1 9.1Z"/></svg>';
const themeBtn = () => `<button class="theme" data-act="theme" aria-label="${isDark() ? 'Włącz jasny tryb' : 'Włącz ciemny tryb'}" title="${isDark() ? 'Jasny tryb' : 'Ciemny tryb'}">${isDark() ? SUN : MOON}</button>`;
try { theme = localStorage.getItem('mikolaj.theme') || 'auto'; } catch {}

const me = () => S.data.user;
const member = id => S.data.members.find(m => m.id === id);
const wish = id => S.data.wishes.find(w => w.id === id);
const wishesOf = id => S.data.wishes.filter(w => w.ownerId === id);
const managedBy = id => S.data.members.filter(m => m.managedBy === id);
const myRes = () => S.data.wishes.filter(w => w.taken === 'me');
const status = w => !w.taken ? 'free' : w.taken === 'me' ? 'mine' : 'taken';
// tryb organizatora: włączany w tej sesji, serwer sam go wyłącza po godzinie
const god = () => me().isAdmin && me().adminUntil > Date.now() / 1000;
const accountsBut = id => S.data.members.filter(m => !m.managedBy && m.id !== id);
const secKey = (kind, owner) => owner === me().id ? `s:${kind}` : `s:${kind}:${owner}`;

/* ===================== API ===================== */
async function api(path, method = 'GET', body) {
  if (S.demo) return demoApi(path, method, body || {});
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET' && method !== 'DELETE') { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body || {}); }
  let res, data = {};
  try { res = await fetch('/api/' + path, init); data = await res.json(); }
  catch { throw new Error('Brak połączenia. Spróbuj ponownie.'); }
  if (!res.ok) {
    if (res.status === 401 && S.data?.user) { S.data = null; go('login'); }
    throw new Error(data.error || 'Coś poszło nie tak. Spróbuj ponownie.');
  }
  return data;
}
async function refresh() {
  S.data = await api('state');
  S.admin = S.screen === 'family' && S.data.user?.isAdmin ? await api('admin') : null;
}
let busy = false;
async function act(fn, msg, undo) {
  if (busy) return;
  busy = true;
  try { await fn(); await refresh(); render(); if (msg) toast(msg, undo); }
  catch (e) { toast(e.message); }
  finally { busy = false; }
}
async function copy(url, msg) {
  try { await navigator.clipboard.writeText(url); toast(msg); }
  catch { window.prompt('Skopiuj ten link:', url); }
}

/* ===================== DEMO =====================
   Przykładowa rodzina w pamięci przeglądarki — ten sam kształt danych co /api, bez serwera.
   Zasady jak w backendzie: obdarowany nie widzi rezerwacji na swojej liście. */
let demo;
function demoSeed() {
  const m = (id, name, letter, extra = {}) => ({ id, name, letter, email: id + '@przyklad.pl', canAdd: false, isAdmin: false, managedBy: null, ...extra });
  const w = (id, ownerId, title, note, url, tier) => ({ id, ownerId, title, note, url, tier });
  return {
    me: 'ania', n: 0, invite: 'demo'.padEnd(64, '0'),
    members: [
      m('ania', 'Ania', 'w tym roku dużo czytam i uczę się piec chleb na zakwasie. Najbardziej ucieszy mnie coś, co przyda się w kuchni. Noszę rozmiar M. Proszę — żadnych świeczek zapachowych!', { isAdmin: true, canAdd: true }),
      m('bartek', 'Bartek', 'piszę krótko, bo wolę rower niż pisanie listów. Jeżdżę do pracy cały rok, więc przyda mi się wszystko, co pomaga zimą. Kubków mam już naprawdę dość.'),
      m('marta', 'Marta', 'chciałabym w nowym roku znaleźć więcej czasu na rysowanie. Lubię ciepłe kolory i rzeczy robione ręcznie.', { canAdd: true }),
      m('tomek', 'Tomek', 'byłem w tym roku grzeczny (prawie zawsze). Lubię klocki, kosmos i dinozaury. Nie lubię swetrów, które drapią.', { managedBy: 'ania', email: null }),
      m('jurek', 'Dziadek Jurek', 'najlepiej czuję się na działce i przy radiu. Przydadzą mi się ciepłe kapcie, rozmiar 43.', { managedBy: 'marta', email: null }),
    ],
    wishes: [
      w('w1', 'ania', 'Książka o pieczeniu chleba', 'Dla początkujących, z przepisami na zakwas.', 'https://www.empik.com/', 'ok'),
      w('w2', 'ania', 'Ciepłe skarpety wełniane', 'Rozmiar 38–40, byle nie różowe.', '', 'small'),
      w('w3', 'ania', 'Bilety do teatru', 'Dowolny spektakl — chętnie we dwoje.', '', 'good'),
      w('w4', 'bartek', 'Tylna lampka rowerowa', 'Ładowana przez USB.', 'https://www.decathlon.pl/', 'ok'),
      w('w5', 'bartek', 'Zimowe rękawiczki rowerowe', 'Rozmiar L, z palcami do ekranu.', '', 'ok'),
      w('w6', 'bartek', 'Gra planszowa dla dwóch osób', 'Coś do 30 minut.', '', 'ok'),
      w('w7', 'bartek', 'Kalendarz ścienny ze zdjęciami gór', '', '', 'small'),
      w('w8', 'bartek', 'Rower szosowy', 'Rama 56 cm. Wiem, że to dużo — można się złożyć.', '', 'angel'),
      w('w9', 'marta', 'Zestaw akwareli w kostkach', '24 kolory, w metalowym pudełku.', 'https://www.empik.com/', 'ok'),
      w('w10', 'marta', 'Szkicownik A5 z grubym papierem', 'Papier co najmniej 200 g/m².', '', 'small'),
      w('w11', 'marta', 'Weekendowe warsztaty ceramiki', 'Termin dowolny.', '', 'good'),
      w('w12', 'tomek', 'Klocki — stacja kosmiczna', 'Dla 8+, najlepiej z astronautami.', 'https://allegro.pl/', 'good'),
      w('w13', 'tomek', 'Latarka czołowa', 'Do czytania pod kołdrą.', '', 'small'),
      w('w14', 'tomek', 'Książka o dinozaurach', 'Z dużymi ilustracjami.', '', 'ok'),
      w('w15', 'jurek', 'Kapcie z owczej wełny', 'Rozmiar 43, zakryta pięta.', '', 'ok'),
      w('w16', 'jurek', 'Radio z dużymi pokrętłami', 'Na prąd z gniazdka, nie na baterie.', '', 'ok'),
    ],
    res: [
      { wishId: 'w4', by: 'ania', purchased: true, was: 'ok' },
      { wishId: 'w12', by: 'ania', purchased: false, was: 'ok' },
      { wishId: 'w16', by: 'ania', purchased: false, was: 'ok' },
      { wishId: 'w5', by: 'marta', purchased: false, was: 'ok' },
      { wishId: 'w10', by: 'bartek', purchased: true, was: 'small' },
      { wishId: 'w1', by: 'bartek', purchased: true, was: 'ok' },
      { wishId: 'w14', by: 'marta', purchased: false, was: 'ok' },
      { wishId: 'w15', by: 'bartek', purchased: false, was: 'ok' },
    ],
  };
}
function demoApi(path, method, body) {
  const D = demo, me = D.members.find(m => m.id === D.me);
  const fail = msg => { throw new Error(msg); };
  const res = id => D.res.find(r => r.wishId === id);
  const mem = id => D.members.find(m => m.id === id) || fail('Nie znaleziono tej osoby.');
  const canEdit = m => m.id === me.id || m.managedBy === me.id || D.until > Date.now() / 1000;
  const out = v => Promise.resolve(JSON.parse(JSON.stringify(v)));
  const [a, id, sub] = path.split('/');
  if (path === 'state') return out({
    family: { name: 'Nowakowie' },
    user: { id: me.id, name: me.name, email: me.email, isAdmin: me.isAdmin, canAdd: me.canAdd || me.isAdmin, adminUntil: me.isAdmin && D.until > Date.now() / 1000 ? D.until : 0 },
    members: D.members.map(({ id, name, letter, managedBy }) => ({ id, name, letter, managedBy })),
    wishes: D.wishes.map(w => {
      const r = res(w.id);
      if (w.ownerId === me.id || !r) return w;
      return { ...w, taken: r.by === me.id ? 'me' : 'other', purchased: r.purchased, ...(D.until > Date.now() / 1000 ? { buyerId: r.by } : {}), ...(r.by === me.id && r.was !== w.tier ? { prevTier: r.was } : {}) };
    }),
  });
  if (path === 'admin') return out({
    invite: `${location.origin}/#invite=${D.invite}`,
    members: D.members,
    reservations: D.res.map(r => { const w = D.wishes.find(x => x.id === r.wishId); return { wishId: w.id, title: w.title, tier: w.tier, ownerId: w.ownerId, buyerId: r.by, purchased: r.purchased }; }).filter(r => r.ownerId !== me.id),
    hidden: D.res.reduce((h, r) => { if (D.wishes.find(w => w.id === r.wishId).ownerId === me.id) h[r.by] = (h[r.by] || 0) + 1; return h; }, {}),
  });
  if (path === 'session') { D.until = body.adminMode ? Math.floor(Date.now() / 1000) + 3600 : 0; return out({ ok: true }); }
  if (path === 'logout' || path === 'invite') return out({ ok: true });
  if (a === 'wishes') {
    if (!id) {
      const owner = mem(body.ownerId || me.id);
      if (!canEdit(owner)) fail('Brak uprawnień.');
      const nid = 'd' + ++D.n;
      D.wishes.push({ id: nid, ownerId: owner.id, title: body.title, note: body.note, url: body.url, tier: body.tier });
      return out({ id: nid });
    }
    const w = D.wishes.find(x => x.id === id) || fail('To życzenie nie jest już dostępne.');
    const r = res(id);
    if (sub === 'reserve') {
      if (method === 'POST') { const by = body.buyerId || me.id; if (r && !body.buyerId) fail('Ktoś już wybrał ten prezent.'); if (r) r.by = by; else D.res.push({ wishId: id, by, purchased: false, was: w.tier }); }
      if (method === 'DELETE') D.res = D.res.filter(x => x !== r);
      if (method === 'PATCH') r.purchased = body.purchased;
    } else {
      if (method === 'PATCH') Object.assign(w, { title: body.title, note: body.note, url: body.url, tier: body.tier });
      if (method === 'DELETE') { D.wishes = D.wishes.filter(x => x !== w); D.res = D.res.filter(x => x !== r); }
    }
    return out({ ok: true });
  }
  if (a === 'members') {
    if (!id) { const nid = 'd' + ++D.n; D.members.push({ id: nid, name: body.name, letter: '', email: null, canAdd: false, isAdmin: false, managedBy: me.id }); return out({ id: nid }); }
    const m = mem(id);
    if (sub === 'letter') { if (!canEdit(m)) fail('Brak uprawnień.'); m.letter = body.letter; return out({ ok: true }); }
    if (sub === 'link') return out({ url: `${location.origin}/#link=${'demo'.padEnd(64, '0')}` });
    if (method === 'PATCH') {
      if (body.canAdd !== undefined) m.canAdd = body.canAdd;
      if (body.managedBy) m.managedBy = body.managedBy;
      if (body.admin) { D.members.forEach(x => { x.isAdmin = false; }); m.isAdmin = true; }
    }
    if (method === 'DELETE') {
      const own = D.wishes.filter(w => w.ownerId === id).map(w => w.id);
      D.res = D.res.filter(r => r.by !== id && !own.includes(r.wishId));
      D.wishes = D.wishes.filter(w => w.ownerId !== id);
      D.members.forEach(x => { if (x.managedBy === id) x.managedBy = me.id; });
      D.members = D.members.filter(x => x !== m);
    }
    return out({ ok: true });
  }
  fail('W trybie demo to nie działa.');
}
function startDemo() {
  demo = demoSeed(); S.demo = true; S.open.clear();
  act(async () => { S.screen = 'lists'; history.replaceState(null, '', '#/'); window.scrollTo(0, 0); }, 'Przykładowa rodzina — patrzysz jako Ania');
}
function endDemo() {
  S.demo = false; demo = null; S.data = { user: null }; S.admin = null; S.open.clear();
  go('landing');
}

/* ===================== WIDOKI ===================== */
function fold(key, cls, head, body) {
  const open = S.open.has(key);
  return `<div class="fold ${cls} ${open ? 'open' : ''}" data-fold="${key}">
    <div class="fold-head">${head}<button class="toggle" data-toggle="${key}" aria-expanded="${open}">Zwiń</button></div>
    <div class="peek"><div class="peek-inner">${body}</div></div>
    <button class="more" data-toggle="${key}" aria-expanded="${open}">Rozwiń</button>
  </div>`;
}

function vHead() {
  const bar = S.demo ? `<p class="demo-bar">Przykładowa rodzina — zmiany znikną po odświeżeniu. <button data-act="end-demo">Wyjdź z demo</button></p>` : '';
  const tab = (s, label) => `<button data-go="${s}" ${S.screen === s ? 'aria-current="page"' : ''}>${label}</button>`;
  const until = god() ? new Date(me().adminUntil * 1000).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
  const mode = god() ? `<p class="demo-bar mode-bar">Tryb organizatora do ${until}: możesz zmieniać listy innych i przypisywać prezenty. <button data-act="admin-mode">Wyłącz</button></p>` : '';
  return `${bar}${mode}<header class="head">
    <nav class="nav" aria-label="Nawigacja">${tab('lists', 'Listy')}${tab('mine', 'Moje')}${me().isAdmin ? tab('family', 'Rodzina') : ''}</nav>
    <div class="right">${themeBtn()}<button class="who" data-act="menu" aria-expanded="${S.menu}">${esc(me().name)}</button></div>
  </header>
  <div class="menu ${S.menu ? 'open' : ''}"><div>
    ${me().isAdmin ? `<button data-act="admin-mode">${god() ? 'Wyłącz tryb organizatora' : 'Tryb organizatora'}</button>` : ''}
    <button data-act="logout">Wyloguj</button>
  </div></div>`;
}

function vGift(w) {
  const st = status(w);
  let row;
  if (st === 'free') row = `<button class="a solid" data-act="reserve" data-id="${w.id}">Kupię to</button>`;
  else if (st === 'mine') row = `<span class="st">${w.purchased ? 'Kupione przez Ciebie' : 'Ty to kupujesz'}</span>
    <button class="a quiet" data-act="${w.purchased ? 'buy' : 'cancel'}" data-id="${w.id}">${w.purchased ? 'cofnij' : 'rezygnuję'}</button>`;
  else row = `<span class="st">${w.buyerId ? `${w.purchased ? 'Kupione' : 'Kupuje'}: ${esc(member(w.buyerId)?.name)}` : w.purchased ? 'Już kupione' : 'Ktoś już to kupuje'}</span>`;
  let assign = '';
  if (god() && S.assign === w.id) assign = `<div class="row">
      <label class="sr" for="f-buyer">Kto kupuje</label>
      <select class="in" id="f-buyer"><option value="">Nikt — prezent wolny</option>${accountsBut(w.ownerId).map(a => `<option value="${a.id}" ${a.id === (w.buyerId || (w.taken === 'me' ? me().id : '')) ? 'selected' : ''}>Kupuje: ${esc(a.name)}</option>`).join('')}</select>
      <button class="a solid" data-act="assign-save" data-id="${w.id}">Zapisz</button><button class="a quiet" data-act="assign" data-id="">Anuluj</button></div>`;
  else if (god()) row += `<button class="a quiet" data-act="assign" data-id="${w.id}">przypisz</button>`;
  return `<div class="gift ${st === 'free' ? '' : 'taken'}">
    <span class="t">${esc(w.title)}</span>
    ${w.note ? `<span class="n">${esc(w.note)}</span>` : ''}
    ${w.prevTier ? `<span class="changed">Budżet zmienił się od Twojej rezerwacji — wcześniej ${tier(w.prevTier).range}.</span>` : ''}
    <div class="row">${row}${range(w)}${w.url ? `<a class="a quiet" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">${esc(host(w.url))} ↗</a>` : ''}</div>
    ${assign}
  </div>`;
}

function vLists() {
  const others = S.data.members.filter(m => m.id !== me().id);
  const d = daysToEve();
  const mine = member(me().id);
  const missing = !mine.letter ? 'listu' : !wishesOf(mine.id).length ? 'życzeń' : '';
  const order = { mine: 0, free: 1, taken: 2 };
  return `${vHead()}<section class="fade">
    <div class="title-row"><h1 class="title">Listy</h1>
      ${others.length ? `<button class="a" data-act="toggle-all">Rozwiń wszystkie</button>` : ''}</div>
    <p class="sub">${S.data.family?.name ? esc(S.data.family.name) + ' · ' : ''}${d ? `${d} ${pl(d, 'dzień', 'dni', 'dni')} do Wigilii` : 'Dziś Wigilia'}</p>
    ${missing ? `<p class="nudge">Nie masz jeszcze ${missing}. <button data-go="mine">${missing === 'listu' ? 'Napisz' : 'Dodaj'}</button></p>` : ''}
    <div class="people">
    ${others.length ? others.map(p => {
      const ws = wishesOf(p.id);
      const free = ws.filter(w => !w.taken);
      const f = S.filter[p.id] || 'all';
      const shown = (f === 'free' ? free : ws).slice().sort((a, b) => order[status(a)] - order[status(b)]);
      const by = p.managedBy ? (p.managedBy === me().id ? 'list prowadzisz Ty' : `list prowadzi ${esc(member(p.managedBy)?.name)}`) : '';
      const head = `<button class="name" data-toggle="p:${p.id}">${esc(p.name)}${by ? `<small>${by}</small>` : ''}</button>
        <span class="count">${ws.length ? `${free.length} z ${ws.length} wolne` : 'pusto'}</span>`;
      const body = `
        ${p.letter ? `<p class="letter">Drogi Mikołaju, ${esc(p.letter)}</p>` : ''}
        ${ws.length ? `
          ${free.length !== ws.length ? `<div class="filter">
            <button data-filter="all" data-pid="${p.id}" aria-pressed="${f === 'all'}">wszystkie</button>
            <button data-filter="free" data-pid="${p.id}" aria-pressed="${f === 'free'}">tylko wolne</button>
          </div>` : ''}
          ${shown.length ? byTier(shown, vGift) : '<p class="empty">Wszystko już ktoś kupuje.</p>'}
        ` : `<p class="empty">${p.managedBy === me().id ? 'Nie ma tu jeszcze życzeń.' : `${esc(p.name)} nie ma jeszcze życzeń.`}</p>`}
        ${p.managedBy === me().id ? `<div class="actions mt"><button class="a" data-go="mine">Zmień list i życzenia</button></div>` : ''}`;
      return fold('p:' + p.id, 'person', head, body);
    }).join('') : `<p class="empty">Nikogo tu jeszcze nie ma.${me().isAdmin ? '' : ' Organizator może wysłać zaproszenie.'}</p>
      ${me().isAdmin ? '<div class="actions mt"><button class="a solid" data-go="family">Zaproś bliskich</button></div>' : ''}`}
    </div>
  </section>`;
}

function wishForm(w, isNew) {
  return `<div class="form">
    <input class="in" id="f-title" value="${esc(w.title)}" placeholder="Co chcesz dostać?" maxlength="160">
    <textarea class="in" id="f-note" placeholder="Wskazówki — rozmiar, kolor, marka" maxlength="1500">${esc(w.note)}</textarea>
    <select class="in" id="f-tier" aria-label="Budżet" required>
      <option value="" disabled ${w.tier ? '' : 'selected'}>Ile może kosztować?</option>
      ${TIERS.map(t => `<option value="${t.id}" ${w.tier === t.id ? 'selected' : ''}>${t.name} — ${t.range}</option>`).join('')}
    </select>
    <input class="in" id="f-url" value="${esc(w.url)}" placeholder="Link (opcjonalnie)" maxlength="2000" inputmode="url">
    <div class="actions">
      <button class="a solid" data-act="save-wish" data-id="${isNew ? '' : w.id}" data-owner="${w.ownerId}">${isNew ? 'Dodaj' : 'Zapisz'}</button>
      <button class="a quiet" data-act="close-edit">Anuluj</button>
      ${isNew ? '' : `<button class="a quiet push" data-act="delete-wish" data-id="${w.id}">Usuń</button>`}
    </div>
    ${!isNew && S.confirm?.act === 'delete-wish' && S.confirm.id === w.id ? confirmBox('delete-wish', w.id, 'Usunąć to życzenie? Jeśli ktoś je już kupuje, rezerwacja też zniknie.', 'Usuń') : ''}
  </div>`;
}
const confirmBox = (act, id, q, yes) => `<div class="confirm"><p>${q}</p><div class="actions">
  <button class="a solid" data-act="${act}" data-id="${id || ''}" data-sure="1">${yes}</button><button class="a quiet" data-act="confirm-cancel">Anuluj</button></div></div>`;

// list + życzenia jednej osoby (mojej albo prowadzonej przeze mnie)
function ownerBlocks(ownerId) {
  const own = ownerId === me().id;
  const m = member(ownerId);
  const ws = wishesOf(ownerId);
  const letterBody = S.editLetter === ownerId
    ? `<div class="form"><label class="sr" for="f-letter">Treść listu</label>
        <textarea class="in big" id="f-letter" maxlength="4000" placeholder="${own ? 'Drogi Mikołaju, w tym roku…' : `Napisz tak, jak ${esc(m.name)} by to powiedział(a)…`}">${esc(m.letter)}</textarea>
        <div class="actions"><button class="a solid" data-act="save-letter" data-owner="${ownerId}">Zapisz</button><button class="a quiet" data-act="cancel-letter">Anuluj</button></div></div>`
    : m.letter
      ? `<p class="mine-letter"><span class="salut">Drogi Mikołaju,</span> ${esc(m.letter)}</p><div class="actions"><button class="a" data-act="edit-letter" data-owner="${ownerId}">Edytuj list</button></div>`
      : `<p class="empty">${own ? 'Nie masz jeszcze listu. Kilka zdań o tym, co lubisz, a czego nie.' : `${esc(m.name)} nie ma jeszcze listu. Możesz go spisać z rozmowy.`}</p>
         <div class="actions mt"><button class="a solid" data-act="edit-letter" data-owner="${ownerId}">Napisz list</button></div>`;
  // opiekun nie jest obdarowanym, więc widzi, co już ktoś kupuje — żeby nie dopisywać dubli
  const stLine = w => !w.taken ? '' : `<span class="st">${w.taken === 'me' ? 'Ty to kupujesz' : w.purchased ? 'Już kupione' : 'Ktoś już to kupuje'}</span>`;
  const wishesBody = `
    <p class="priv">${own ? 'Nie widzisz, co już ktoś dla Ciebie kupuje.' : 'Widzisz, co inni już kupili z tej listy. Nie zdradź niespodzianki.'}</p>
    ${byTier(ws, w => S.editWish === w.id ? wishForm(w, false) : `<div class="gift">
      <span class="t">${esc(w.title)}</span>
      ${w.note ? `<span class="n">${esc(w.note)}</span>` : ''}
      <div class="row"><button class="a" data-edit="${w.id}">Zmień</button>${stLine(w)}${range(w)}${w.url ? `<span class="st">${esc(host(w.url))}</span>` : ''}</div>
    </div>`)}
    ${S.adding === ownerId ? wishForm({ title: '', note: '', url: '', tier: '', ownerId }, true)
      : `<div class="actions mt"><button class="a solid" data-act="add" data-owner="${ownerId}">${ws.length ? 'Dodaj życzenie' : 'Dodaj pierwsze życzenie'}</button></div>`}`;
  const label = own ? ['List', 'Życzenia'] : [`${esc(m.name)} · list`, `${esc(m.name)} · życzenia`];
  return fold(secKey('letter', ownerId), 'sec', `<h2>${label[0]}</h2>`, letterBody)
       + fold(secKey('wishes', ownerId), 'sec', `<h2>${label[1]}${ws.length ? ` · ${ws.length}` : ''}</h2>`, wishesBody);
}

function vMine() {
  const res = myRes();
  const bought = res.filter(w => w.purchased).length;
  const managed = managedBy(me().id);
  const buyingBody = res.length ? res.map(w => `<div class="gift ${w.purchased ? 'done' : ''}">
      <span class="t">${esc(w.title)}</span>
      <span class="n">dla: ${esc(member(w.ownerId)?.name)} · ${tier(w.tier).range}</span>
      ${w.prevTier ? `<span class="changed">Budżet zmienił się od Twojej rezerwacji — wcześniej ${tier(w.prevTier).range}.</span>` : ''}
      <div class="row">
        <button class="a ${w.purchased ? 'quiet' : ''}" data-act="buy" data-id="${w.id}">${w.purchased ? 'cofnij zakup' : 'Oznacz jako kupione'}</button>
        <button class="a quiet" data-act="cancel" data-id="${w.id}">rezygnuję</button>
        ${w.url ? `<a class="a quiet" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">${esc(host(w.url))} ↗</a>` : ''}
      </div>
    </div>`).join('')
    : `<p class="empty">Nic jeszcze nie kupujesz.</p><div class="actions mt"><button class="a" data-go="lists">Przejrzyj listy</button></div>`;
  const buying = fold('s:buying', 'sec', `<h2>Kupuję${res.length ? ` · ${bought} z ${res.length} kupione` : ''}</h2>`, buyingBody);

  const managedHtml = managed.map(m => `
    <div class="managed">
      <h2 class="managed-name">${esc(m.name)}</h2>
      <p class="sub">Ty prowadzisz tę listę: wpisujesz list i życzenia. Prezenty dla innych rezerwujesz na swoim koncie.</p>
      ${ownerBlocks(m.id)}
      <div class="actions managed-actions">
        <button class="a quiet" data-act="person-link" data-id="${m.id}">Daj własne konto</button>
        <button class="a quiet" data-act="remove-person" data-id="${m.id}">Usuń osobę</button>
      </div>
      ${S.confirm?.act === 'remove-person' && S.confirm.id === m.id ? confirmBox('remove-person', m.id, `Usunąć: ${esc(m.name)}? Zniknie list i życzenia tej osoby.`, 'Usuń') : ''}
    </div>`).join('');

  const addPerson = !me().canAdd ? '' : S.addingPerson
    ? `<div class="add-person"><div class="form">
        <input class="in" id="f-person" placeholder="Imię, np. Zosia albo Babcia Hela" maxlength="60">
        <div class="actions"><button class="a solid" data-act="save-person">Dodaj osobę</button><button class="a quiet" data-act="cancel-person">Anuluj</button></div>
      </div></div>`
    : `<div class="add-person">
        <p class="sub">Dziecko bez telefonu albo ktoś, kto nie chce korzystać z aplikacji? Dodaj tę osobę i wpisuj list oraz życzenia za nią.</p>
        <div class="actions mt"><button class="a" data-act="add-person">Dodaj osobę</button></div>
      </div>`;

  // Kupuję na górze, gdy coś w niej jest; pusta sekcja ląduje na dole
  return `${vHead()}<section class="fade">
    <h1 class="title">${esc(me().name)}</h1>
    <p class="sub">To, co kupujesz innym, Twój list i życzenia${managed.length ? ' oraz osoby, które prowadzisz' : ''}.</p>
    ${res.length ? buying : ''}
    ${ownerBlocks(me().id)}
    ${managedHtml}
    ${res.length ? '' : buying}
    ${addPerson}
  </section>`;
}

function vFamily() {
  const A = S.admin;
  if (!A) return `${vHead()}<p class="empty">Wczytywanie…</p>`;
  const name = id => id === me().id ? 'Ty' : esc(A.members.find(m => m.id === id)?.name || '—');
  const resRow = (r, who) => `<div class="res ${r.purchased ? 'done' : ''}"><span class="t">${esc(r.title)}</span>
    <span class="n">${who} · ${r.purchased ? 'kupione' : 'do kupienia'} · ${tier(r.tier).range}</span></div>`;
  const accounts = A.members.filter(m => !m.managedBy);
  let resHtml;
  if (S.famView === 'buyer') {
    resHtml = accounts.map(b => {
      const rs = A.reservations.filter(r => r.buyerId === b.id);
      const hidden = A.hidden[b.id] || 0;
      const you = b.id === me().id ? ' <span class="you">(Ty)</span>' : '';
      if (!rs.length && !hidden) return `<div class="res-group"><h3>${esc(b.name)}${you}</h3><p class="empty">Nic jeszcze nie kupuje.</p></div>`;
      return `<div class="res-group"><h3>${esc(b.name)}${you}<span>${rs.filter(r => r.purchased).length} z ${rs.length} kupione</span></h3>
        ${rs.map(r => resRow(r, `dla: ${name(r.ownerId)}`)).join('')}
        ${hidden ? `<p class="empty">+ ${hidden} dla Ciebie — ukryte</p>` : ''}</div>`;
    }).join('');
  } else {
    resHtml = A.members.filter(m => m.id !== me().id).map(m => {
      const total = wishesOf(m.id).length;
      const rs = A.reservations.filter(r => r.ownerId === m.id);
      return `<div class="res-group"><h3>${esc(m.name)}<span>${rs.length} z ${total} zajęte</span></h3>
        ${rs.length ? rs.map(r => resRow(r, `kupuje ${name(r.buyerId)}`)).join('') : '<p class="empty">Nikt jeszcze nic nie wybrał.</p>'}</div>`;
    }).join('') + `<p class="priv mt">Twojej listy tu nie ma — żeby nie zepsuć Ci niespodzianki.</p>`;
  }

  const confirming = (act, id) => S.confirm?.act === act && S.confirm.id === id;
  const people = A.members.slice().sort((a, b) => (a.id === me().id ? -1 : b.id === me().id ? 1 : 0) || (!!a.managedBy - !!b.managedBy));
  const row = m => {
    const own = m.id === me().id, open = S.fam === m.id;
    const meta = m.managedBy ? `bez konta · prowadzi ${name(m.managedBy)}`
      : [esc(m.email), m.isAdmin ? 'organizator' : '', m.canAdd ? 'może dodawać osoby' : ''].filter(Boolean).join(' · ');
    let actions = '';
    const editBtn = own || !god() ? '' : `<button class="a" data-act="edit-person" data-id="${m.id}">Edytuj list i życzenia</button>`;
    if (open && !m.managedBy) actions = `<div class="fam-actions">
        ${editBtn}
        ${own ? '' : `<button class="a" data-act="person-link" data-id="${m.id}">Link do nowego hasła</button>`}
        <button class="a" data-act="toggle-add" data-id="${m.id}" data-on="${m.canAdd ? '' : '1'}">${m.canAdd ? 'Nie może dodawać osób' : 'Może dodawać osoby'}</button>
        ${own ? '' : `<button class="a" data-act="make-admin" data-id="${m.id}">Przekaż rolę organizatora</button>
        <button class="a quiet" data-act="remove-member" data-id="${m.id}">Usuń z rodziny</button>`}
      </div>
      ${confirming('make-admin', m.id) ? confirmBox('make-admin', m.id, `${esc(m.name)} zostanie organizatorem. Ty stracisz dostęp do tej zakładki.`, 'Przekaż') : ''}
      ${confirming('remove-member', m.id) ? confirmBox('remove-member', m.id, `${esc(m.name)} straci dostęp. Znikną list, życzenia i rezerwacje tej osoby.${A.members.some(x => x.managedBy === m.id) ? ' Osoby, które prowadzi, przejdą do Ciebie.' : ''}`, 'Usuń') : ''}`;
    if (open && m.managedBy) actions = `<div class="fam-actions">
        ${editBtn}
        <label class="sr" for="f-manager">Opiekun</label>
        <select class="in" id="f-manager">${accounts.map(a => `<option value="${a.id}" ${a.id === m.managedBy ? 'selected' : ''}>Prowadzi: ${esc(a.name)}</option>`).join('')}</select>
        <button class="a" data-act="save-manager" data-id="${m.id}">Zmień opiekuna</button>
        <button class="a" data-act="person-link" data-id="${m.id}">Daj własne konto</button>
        <button class="a quiet" data-act="remove-member" data-id="${m.id}">Usuń z rodziny</button>
      </div>
      ${confirming('remove-member', m.id) ? confirmBox('remove-member', m.id, `Zniknie list i życzenia: ${esc(m.name)}.`, 'Usuń') : ''}`;
    return `<div class="fam">
      <button class="fam-btn" data-act="fam" data-id="${m.id}" aria-expanded="${open}">
        <span class="t">${esc(m.name)}${own ? ' <span class="you">(Ty)</span>' : ''}</span>
        <span class="more-txt">${open ? 'Zamknij' : 'Zarządzaj'}</span>
        <span class="n">${meta}</span>
      </button>${actions}</div>`;
  };
  const tok = A.invite.split('=').pop();
  const who = `<h2 class="label">Kto co kupuje</h2>
    <div class="filter">
      <button data-act="fam-view" data-v="for" aria-pressed="${S.famView !== 'buyer'}">dla kogo</button>
      <button data-act="fam-view" data-v="buyer" aria-pressed="${S.famView === 'buyer'}">kto kupuje</button>
    </div>
    ${resHtml}`;
  const invite = `<h2 class="label">Zaproszenie</h2>
    <p class="fam-text">Każdy, kto ma ten link, może dołączyć do rodziny. Wysyłaj go prywatnie — SMS-em albo w komunikatorze.</p>
    <p class="linkline">…/#invite=${esc(tok.slice(0, 4))}…${esc(tok.slice(-3))}</p>
    <div class="actions">
      <button class="a solid" data-act="copy-invite">Skopiuj link</button>
      <button class="a quiet" data-act="new-invite">Utwórz nowy link</button>
    </div>
    ${S.confirm?.act === 'new-invite' ? confirmBox('new-invite', '', 'Stary link przestanie działać. Osoby, które już dołączyły, zostają.', 'Utwórz nowy') : ''}`;
  const addPeople = `<h2 class="label">Dodaj osoby</h2>
    <p class="fam-text">Wpisz imiona, każde w osobnej linii. Te osoby nie mają konta — prowadzisz je Ty. Potem możesz dać im własne konto linkiem albo zmienić opiekuna.</p>
    <div class="form"><label class="sr" for="f-people">Imiona</label>
      <textarea class="in" id="f-people" placeholder="${'Babcia Hela&#10;Dziadek Jurek&#10;Zosia'}"></textarea>
      <div class="actions"><button class="a solid" data-act="add-people">Dodaj osoby</button></div></div>`;
  const mode = `<h2 class="label">Tryb organizatora</h2>
    <p class="fam-text">Na wszelki wypadek: zmieniasz listy i życzenia innych osób i przypisujesz za nich prezenty. Włącza się tylko w tej sesji i wyłącza sam po godzinie. Twojej listy nadal nie widzisz.</p>
    <div class="actions mt">${god() ? '<button class="a" data-act="admin-mode">Wyłącz tryb organizatora</button>' : '<button class="a solid" data-act="admin-mode">Włącz na godzinę</button>'}</div>`;
  return `${vHead()}<section class="fade">
    <h1 class="title">Rodzina</h1>
    <p class="sub">Tę zakładkę widzisz tylko Ty, bo jesteś organizatorem.</p>
    ${A.reservations.length ? who + invite + addPeople : invite + addPeople + who}
    <h2 class="label">Osoby · ${A.members.length}</h2>
    ${people.map(row).join('')}
    ${mode}
  </section>`;
}

// organizator w swoim trybie edytuje listę innej osoby
function vEdit() {
  const m = member(S.editOwner);
  if (!m || !god()) { S.screen = 'family'; return vFamily(); }
  return `${vHead()}<section class="fade">
    <div class="actions"><button class="a quiet" data-go="family">← Rodzina</button></div>
    <h1 class="title mt">${esc(m.name)}</h1>
    <p class="sub">Zmieniasz jako organizator. ${esc(m.name)} zobaczy zmiany na swojej liście.</p>
    ${ownerBlocks(m.id)}
  </section>`;
}

const PUB = () => `<header class="head pub"><button class="mark" data-go="landing">Mikołaj</button>${themeBtn()}</header>`;
function vAuth() {
  const I = S.info || {};
  const account = `<input class="in" name="name" placeholder="Twoje imię" maxlength="60" required autocomplete="given-name">
      <input class="in" name="email" type="email" placeholder="E-mail — posłuży do logowania" required autocomplete="email">
      <input class="in" name="password" type="password" placeholder="Hasło, min. 4 znaki" minlength="4" required autocomplete="new-password">`;
  if (S.screen === 'register') return `${PUB()}<section class="auth fade">
    <h1 class="title">Załóż rodzinę</h1>
    <p class="sub">Zostajesz organizatorem: zapraszasz bliskich linkiem i możesz dodać osoby bez telefonu.</p>
    <form class="form" data-form="register">
      <input class="in" name="familyName" placeholder="Nazwa rodziny, np. Kowalscy" maxlength="80" required>
      ${account}
      <div class="actions"><button class="a solid">Załóż rodzinę</button></div>
    </form>
    <p class="foot">Masz już konto? <button class="a" data-go="login">Zaloguj się</button></p>
  </section>`;
  if (S.screen === 'join') return `${PUB()}<section class="auth fade">
    <h1 class="title">Zaproszenie</h1>
    <p class="sub">${I.from ? esc(I.from) + ' zaprasza' : 'Zapraszamy'} Cię do rodziny ${esc(I.familyName)} — do wspólnych list do Mikołaja.</p>
    <form class="form" data-form="join">
      <input class="in" name="name" placeholder="Imię" maxlength="60" required autocomplete="given-name">
      <input class="in" name="email" type="email" placeholder="E-mail — posłuży do logowania" required autocomplete="email">
      <input class="in" name="password" type="password" placeholder="Hasło, min. 4 znaki" minlength="4" required autocomplete="new-password">
      <div class="actions"><button class="a solid">Dołączam</button></div>
    </form>
  </section>`;
  if (S.screen === 'link') return `<section class="auth fade">
    <h1 class="title">Cześć, ${esc(I.name)}</h1>
    <p class="sub">${I.needsEmail ? 'Ustaw e-mail i hasło — od teraz sam(a) prowadzisz swoją listę.' : 'Ustaw nowe hasło.'}</p>
    <form class="form" data-form="link">
      ${I.needsEmail ? '<input class="in" name="email" type="email" placeholder="E-mail — posłuży do logowania" required autocomplete="email">' : ''}
      <input class="in" name="password" type="password" placeholder="Nowe hasło, min. 4 znaki" minlength="4" required autocomplete="new-password">
      <div class="actions"><button class="a solid">Zapisz</button></div>
    </form>
  </section>`;
  if (S.screen !== 'login') return vLanding();
  return `${PUB()}<section class="auth fade">
    <h1 class="title">Zaloguj się</h1>
    <p class="sub">Do rodzinnych list do Mikołaja.</p>
    <form class="form" data-form="login">
      <input class="in" name="email" type="email" placeholder="E-mail" required autocomplete="email">
      <input class="in" name="password" type="password" placeholder="Hasło" required autocomplete="current-password">
      <div class="actions"><button class="a solid">Zaloguj się</button></div>
    </form>
    <p class="foot">Nie masz konta? <button class="a" data-go="register">Załóż rodzinę</button> albo poproś bliskich o link zaproszenia. Zapomniane hasło? Organizator rodziny wyśle Ci nowy link.</p>
  </section>`;
}

// strona startowa dla niezalogowanych
function vLanding() {
  const d = daysToEve();
  const point = (h, t) => `<div class="point"><h3>${h}</h3><p>${t}</p></div>`;
  return `<header class="head pub">
    <button class="mark" data-go="landing">Mikołaj</button>
    <div class="right">${themeBtn()}<button class="a" data-go="login">Zaloguj się</button></div>
  </header>
  <section class="landing fade">
    <h1 class="hero">Listy do Mikołaja dla całej rodziny.</h1>
    <p class="lead">Każdy pisze, czego by chciał. Bliscy wybierają prezenty tak, żeby nikt nie kupił tego samego — a niespodzianka zostaje niespodzianką.</p>
    <p class="sub">${d ? `${d} ${pl(d, 'dzień', 'dni', 'dni')} do Wigilii` : 'Dziś Wigilia'}</p>
    <div class="actions cta"><button class="a solid" data-go="register">Załóż rodzinę</button><button class="a" data-act="demo">Zobacz przykład</button></div>
    <p class="sample"><span>Drogi Mikołaju,</span> w tym roku dużo czytam i uczę się piec chleb. Noszę rozmiar M. Proszę — żadnych świeczek zapachowych!</p>
    <h2 class="label">Jak to działa</h2>
    ${point('Każdy pisze list', 'Kilka zdań do Mikołaja i lista życzeń.')}
    ${point('Bliscy wybierają prezent', 'Kto chce, rezerwuje kupienie komuś prezentu.')}
    ${point('Niespodzianka zostaje niespodzianką', 'Nie widzisz, co inni kupują — tylko swoje.')}
    ${point('Także za dziadków i dzieci', 'Bez wykluczania — da się wpisać list za kogoś.')}
    <h2 class="label">Jak zacząć</h2>
    <p class="fam-text">Załóż rodzinę — zostajesz jej organizatorem. Potem wyślij bliskim link zaproszenia, a dziadków czy dzieci dodaj sam. Każda rodzina widzi tylko swoje listy.</p>
    <div class="actions mt"><button class="a solid" data-go="register">Załóż rodzinę</button><button class="a" data-go="login">Mam już konto</button></div>
    <h2 class="label">Wypróbuj</h2>
    <p class="fam-text">Zobacz, jak to wygląda na przykładowej rodzinie — bez konta. Możesz rezerwować, pisać listy i zajrzeć do zakładki organizatora. Nic się nie zapisuje.</p>
    <div class="actions mt"><button class="a" data-act="demo">Otwórz przykładową rodzinę</button></div>
  </section>`;
}

/* ===================== RENDER ===================== */
let modeTimer;
function scheduleModeEnd() {
  clearTimeout(modeTimer);
  if (S.data?.user && god()) modeTimer = setTimeout(() => act(async () => {}, 'Tryb organizatora wyłączył się'), me().adminUntil * 1000 - Date.now() + 500);
}
const TABS = { lists: '#/', mine: '#/moje', family: '#/rodzina' };
const PUBLIC = { landing: '#/', login: '#/zaloguj', register: '#/zaloz' };
function render(animate = false) {
  const y = window.scrollY;
  const loggedIn = S.data?.user;
  if (loggedIn && !TABS[S.screen] && S.screen !== 'edit') S.screen = 'lists';
  if (!loggedIn && !['login', 'register', 'join', 'link'].includes(S.screen)) S.screen = 'landing';
  if ((S.screen === 'family' || S.screen === 'edit') && !me()?.isAdmin) S.screen = 'lists';
  scheduleModeEnd();
  const view = !loggedIn ? vAuth() : { lists: vLists, mine: vMine, family: vFamily, edit: vEdit }[S.screen]();
  $('#app').innerHTML = view;
  if (!animate) { $('.fade')?.classList.remove('fade'); window.scrollTo(0, y); }
  markFits();
  syncAll();
}
function go(screen) {
  Object.assign(S, { screen, menu: false, editWish: null, adding: null, editLetter: null, addingPerson: false, fam: null, confirm: null, assign: null });
  const hash = (S.data?.user ? TABS : PUBLIC)[screen];
  if (hash) history.replaceState(null, '', hash);
  window.scrollTo(0, 0);
  render(true);
  if (screen === 'family') act(() => {});
}
// sekcje, które mieszczą się w podglądzie, nie potrzebują „Rozwiń”
function markFits() {
  document.querySelectorAll('.fold').forEach(f => {
    const limit = parseFloat(getComputedStyle(f).getPropertyValue('--peek'));
    f.classList.toggle('fits', f.querySelector('.peek-inner').offsetHeight <= limit + 24);
  });
}
function syncAll() {
  const b = $('[data-act="toggle-all"]'); if (!b) return;
  const keys = [...document.querySelectorAll('.person:not(.fits)')].map(f => f.dataset.fold);
  b.textContent = keys.length && keys.every(k => S.open.has(k)) ? 'Zwiń wszystkie' : 'Rozwiń wszystkie';
}
// płynne rozwijanie i zwijanie bez przerysowania
function toggleFold(key, bulk = false) {
  const f = document.querySelector(`[data-fold="${key}"]`);
  if (!f || f.classList.contains('fits')) return;
  const peek = f.querySelector('.peek');
  const open = !S.open.has(key);
  open ? S.open.add(key) : S.open.delete(key);
  f.querySelectorAll('[data-toggle]').forEach(b => b.setAttribute('aria-expanded', open));
  if (open) {
    peek.style.maxHeight = peek.scrollHeight + 'px';
    f.classList.add('open');
    peek.addEventListener('transitionend', () => { if (S.open.has(key)) peek.style.maxHeight = ''; }, { once: true });
  } else {
    // nagłówek przyklejony w głębi listy — wróć do początku sekcji
    const top = f.getBoundingClientRect().top;
    if (top < 0 && !bulk) window.scrollBy(0, top);
    peek.style.maxHeight = peek.scrollHeight + 'px';
    peek.offsetHeight;
    f.classList.remove('open');
    peek.style.maxHeight = '';
  }
}

let toastTimer, undoFn = null;
function toast(msg, undo) {
  $('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast'; el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-act="undo">Cofnij</button>' : ''}`;
  document.body.appendChild(el);
  undoFn = undo || null;
  toastTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 200); }, 4000);
}
const focusFirst = () => setTimeout(() => $('.form .in')?.focus(), 0);
function setTheme(t) {
  theme = t;
  try { localStorage.setItem('mikolaj.theme', t); } catch {}
  t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t);
}

/* ===================== ZDARZENIA ===================== */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-toggle],[data-edit],[data-act],[data-filter]');
  if (!t) return;
  const d = t.dataset;
  if (d.go) return go(d.go);
  if (d.toggle) { toggleFold(d.toggle); return syncAll(); }
  if (d.edit) { S.editWish = d.edit; S.adding = null; S.confirm = null; S.open.add(secKey('wishes', wish(d.edit).ownerId)); render(); return focusFirst(); }
  if (d.filter) { S.filter[d.pid] = d.filter; return render(); }
  const id = d.id;
  switch (d.act) {
    case 'toggle-all': {
      const keys = [...document.querySelectorAll('.person:not(.fits)')].map(f => f.dataset.fold);
      const expand = !keys.every(k => S.open.has(k));
      if (!expand) window.scrollTo({ top: 0, behavior: 'smooth' });
      keys.forEach(k => { if (S.open.has(k) !== expand) toggleFold(k, true); });
      return syncAll(); }
    case 'menu': S.menu = !S.menu; $('.menu').classList.toggle('open', S.menu); t.setAttribute('aria-expanded', S.menu); return;
    case 'theme': setTheme(isDark() ? 'light' : 'dark'); return render();
    case 'demo': return startDemo();
    case 'end-demo': return endDemo();
    case 'logout': if (S.demo) return endDemo(); return act(async () => { await api('logout', 'POST'); S.screen = 'landing'; history.replaceState(null, '', '#/'); }, null);
    case 'confirm-cancel': S.confirm = null; return render();
    case 'undo': { const f = undoFn; undoFn = null; $('.toast')?.remove(); return f && act(f); }

    // rezerwacje
    case 'reserve': return act(() => api(`wishes/${id}/reserve`, 'POST'), 'Kupujesz to', () => api(`wishes/${id}/reserve`, 'DELETE'));
    case 'buy': { const p = !wish(id).purchased; return act(() => api(`wishes/${id}/reserve`, 'PATCH', { purchased: p }), p ? 'Oznaczone jako kupione' : null); }
    case 'cancel': return act(() => api(`wishes/${id}/reserve`, 'DELETE'), 'Prezent znów jest wolny', () => api(`wishes/${id}/reserve`, 'POST'));

    // życzenia i listy
    case 'add': S.adding = d.owner; S.editWish = null; S.open.add(secKey('wishes', d.owner)); render(); return focusFirst();
    case 'close-edit': S.adding = null; S.editWish = null; S.confirm = null; return render();
    case 'save-wish': {
      const title = $('#f-title').value.trim();
      if (!title) return $('#f-title').focus();
      if (!$('#f-tier').value) return $('#f-tier').focus();
      const f = { title, note: $('#f-note').value.trim(), url: $('#f-url').value.trim(), tier: $('#f-tier').value };
      return act(async () => {
        await (id ? api(`wishes/${id}`, 'PATCH', f) : api('wishes', 'POST', { ...f, ownerId: d.owner }));
        S.adding = null; S.editWish = null;
      }, id ? 'Zapisano' : 'Dodano'); }
    case 'delete-wish':
      if (!d.sure) { S.confirm = { act: 'delete-wish', id }; return render(); }
      return act(async () => { await api(`wishes/${id}`, 'DELETE'); S.editWish = null; S.confirm = null; }, 'Usunięto');
    case 'edit-letter': S.editLetter = d.owner; S.open.add(secKey('letter', d.owner)); render(); return focusFirst();
    case 'cancel-letter': S.editLetter = null; return render();
    case 'save-letter': {
      const letter = $('#f-letter').value.trim();
      return act(async () => { await api(`members/${d.owner}/letter`, 'PATCH', { letter }); S.editLetter = null; }, 'List zapisany'); }

    // osoby prowadzone
    case 'add-person': S.addingPerson = true; render(); return focusFirst();
    case 'cancel-person': S.addingPerson = false; return render();
    case 'save-person': {
      const name = $('#f-person').value.trim();
      if (!name) return $('#f-person').focus();
      return act(async () => {
        const { id: nid } = await api('members', 'POST', { name });
        S.addingPerson = false; S.editLetter = nid; S.open.add(secKey('letter', nid));
        setTimeout(() => { document.querySelector(`[data-fold="${secKey('letter', nid)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); focusFirst(); }, 0);
      }, `Dodano: ${name}`); }
    case 'remove-person':
      if (!d.sure) { S.confirm = { act: 'remove-person', id }; return render(); }
      return act(async () => { await api(`members/${id}`, 'DELETE'); S.confirm = null; }, 'Usunięto');
    case 'person-link': {
      const m = S.admin?.members.find(x => x.id === id) || member(id);
      return act(async () => {
        const { url } = await api(`members/${id}/link`, 'POST');
        await copy(url, m.managedBy ? `Link skopiowany — ${m.name} ustawi w nim e-mail i hasło (ważny 3 dni)` : `Link dla ${m.name} skopiowany. Działa raz, przez 3 dni.`);
      }); }

    // organizator
    case 'fam-view': S.famView = d.v; return render();
    case 'admin-mode': {
      const on = !god();
      return act(async () => { await api('session', 'PATCH', { adminMode: on }); S.menu = false; S.assign = null; if (!on && S.screen === 'edit') S.screen = 'family'; },
        on ? 'Tryb organizatora włączony na godzinę' : 'Tryb organizatora wyłączony'); }
    case 'assign': S.assign = id || null; return render();
    case 'assign-save': {
      const buyerId = $('#f-buyer').value;
      return act(async () => { await (buyerId ? api(`wishes/${id}/reserve`, 'POST', { buyerId }) : api(`wishes/${id}/reserve`, 'DELETE')); S.assign = null; }, buyerId ? 'Przypisano' : 'Prezent znów jest wolny'); }
    case 'edit-person': S.editOwner = id; go('edit'); return;
    case 'add-people': {
      const names = [...new Set($('#f-people').value.split('\n').map(n => n.trim()).filter(Boolean))].slice(0, 30);
      if (!names.length) return $('#f-people').focus();
      return act(async () => { for (const name of names) await api('members', 'POST', { name: name.slice(0, 60) }); },
        `Dodano: ${names.length} ${pl(names.length, 'osoba', 'osoby', 'osób')}. Prowadzisz je w zakładce Moje.`); }
    case 'fam': S.fam = S.fam === id ? null : id; S.confirm = null; return render();
    case 'copy-invite': return copy(S.admin.invite, 'Link skopiowany');
    case 'new-invite':
      if (!d.sure) { S.confirm = { act: 'new-invite' }; return render(); }
      return act(async () => { await api('invite', 'POST'); S.confirm = null; }, 'Nowy link gotowy. Stary już nie działa.');
    case 'toggle-add': return act(() => api(`members/${id}`, 'PATCH', { canAdd: Boolean(d.on) }), 'Zapisano');
    case 'save-manager': return act(() => api(`members/${id}`, 'PATCH', { managedBy: $('#f-manager').value }), 'Opiekun zmieniony');
    case 'make-admin':
      if (!d.sure) { S.confirm = { act: 'make-admin', id }; return render(); }
      return act(async () => { await api(`members/${id}`, 'PATCH', { admin: true }); S.screen = 'lists'; S.confirm = null; S.fam = null; history.replaceState(null, '', '#/'); }, 'Rola organizatora przekazana');
    case 'remove-member':
      if (!d.sure) { S.confirm = { act: 'remove-member', id }; return render(); }
      return act(async () => { await api(`members/${id}`, 'DELETE'); S.confirm = null; S.fam = null; }, 'Usunięto z rodziny');
  }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target, body = Object.fromEntries(new FormData(form));
  const kind = form.dataset.form;
  act(async () => {
    if (kind === 'login') await api('login', 'POST', body);
    if (kind === 'register') await api('register', 'POST', body);
    if (kind === 'join') await api('join', 'POST', { ...body, inviteToken: S.token });
    if (kind === 'link') await api(`link/${S.token}`, 'POST', body);
    S.token = null; S.info = null;
    S.screen = { join: 'mine', register: 'family' }[kind] || 'lists';
    history.replaceState(null, '', TABS[S.screen]);
  }, kind === 'register' ? 'Rodzina założona. Skopiuj link zaproszenia i wyślij go bliskim.' : null);
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !S.data?.user) return;
  if (S.editWish || S.adding || S.editLetter || S.addingPerson || S.confirm) {
    Object.assign(S, { editWish: null, adding: null, editLetter: null, addingPerson: false, confirm: null });
    render();
  }
});

/* ===================== START ===================== */
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'auto') render(); });
async function start() {
  setTheme(theme);
  const hash = location.hash;
  const token = hash.match(/^#(invite|link)=([a-f0-9]{64})$/);
  if (token) {
    // Sekret tylko w pamięci — usuń go z paska adresu.
    history.replaceState(null, '', '#/');
    S.token = token[2];
    try {
      if (token[1] === 'invite') { S.info = await api(`invitation/${S.token}`); S.screen = 'join'; }
      if (token[1] === 'link') { S.info = await api(`link/${S.token}`); S.screen = 'link'; }
    } catch (err) { S.screen = 'login'; S.token = null; setTimeout(() => toast(err.message), 0); }
  } else {
    S.screen = Object.keys(PUBLIC).find(k => k !== 'landing' && PUBLIC[k] === hash) || Object.keys(TABS).find(k => TABS[k] === hash) || 'lists';
  }
  try { await refresh(); } catch (err) { S.data = { user: null }; toast(err.message); }
  // Zalogowany, ale otwiera link? Najpierw link — po zapisaniu wraca do aplikacji.
  if (S.token && S.data.user) S.data = { user: null };
  render(true);
  if (S.screen === 'family' && S.data.user) act(() => {});
}
start();
