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
const range = w => `<span class="st rng">${tier(w.tier).range}</span>`;

/* ===================== STAN ===================== */
const S = {
  data: null, admin: null, token: null, info: null,
  fresh: null,                // stan, który przyszedł w odpowiedzi na zapis
  demo: false,
  screen: 'lists',            // lists | mine | family | login | join | link
  open: new Set(),            // rozwinięte sekcje
  filter: {}, editWish: null, adding: null, editLetter: null, addingPerson: false,
  menu: false, fam: null, famView: 'for', confirm: null, assign: null, editOwner: null,
};
let theme = 'auto';
const isDark = () => theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
const SUN = '<svg class="sun" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.1M10 16.1v2.1M1.8 10h2.1M16.1 10h2.1M4.2 4.2l1.5 1.5M14.3 14.3l1.5 1.5M4.2 15.8l1.5-1.5M14.3 5.7l1.5-1.5"/></svg>';
const MOON = '<svg class="moon" viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 12.6A7 7 0 0 1 7.4 3.5a7 7 0 1 0 9.1 9.1Z"/></svg>';
const themeBtn = () => `<button class="theme" data-act="theme" aria-label="${isDark() ? 'Włącz jasny tryb' : 'Włącz ciemny tryb'}" title="${isDark() ? 'Jasny tryb' : 'Ciemny tryb'}">${SUN}${MOON}</button>`; // ikonę wybiera CSS
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
  if (S.demo) return demoApi(path, method, body);
  const init = { method, credentials: 'same-origin', headers: {}, keepalive: method !== 'GET' };
  if (method !== 'GET' && method !== 'DELETE') { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body || {}); }
  let res, data = {};
  try { res = await fetch('/api/' + path, init); data = await res.json(); }
  catch { throw new Error('Brak połączenia. Spróbuj ponownie.'); }
  if (!res.ok) {
    if (res.status === 401 && S.data?.user) { S.data = null; go('login'); }
    throw new Error(data.error || 'Coś poszło nie tak. Spróbuj ponownie.');
  }
  if (data.state) S.fresh = data.state;
  return data;
}
async function refresh() {
  // po zapisie stan już jest (przyszedł w odpowiedzi); zakładka Rodzina dociąga swój przegląd równolegle
  const admin = S.screen === 'family' && (S.fresh || S.data)?.user?.isAdmin;
  [S.data, S.admin] = await Promise.all([S.fresh || api('state'), admin ? api('admin') : null]);
  S.fresh = null;
}
// Jedna akcja naraz; kliknięty przycisk przygasa, dopóki serwer nie odpowie.
let busy = false, pressed = null;
async function act(fn, msg) {
  if (busy) return;
  busy = true;
  const el = pressed;
  el?.classList.add('wait');
  try { await flushSave(); await fn(); await refresh(); render(); if (msg) toast(msg); }
  catch (e) { S.fresh = null; toast(e.message, true); }
  finally { busy = false; el?.classList.remove('wait'); }
}
async function copy(url, msg) {
  try { await navigator.clipboard.writeText(url); toast(msg); }
  catch { window.prompt('Skopiuj ten link:', url); }
}

/* ===================== AUTOZAPIS =====================
   List i życzenia zapisują się same chwilę po pisaniu — bez przerysowania, żeby nie zgubić kursora.
   Zapisy idą po kolei; każdy niesie wartości z chwili, w której go zaplanowano. */
let saveTimer = null, pending = null, saving = Promise.resolve(), saveError = '';
const saveStatus = msg => { const el = $('.saved'); if (el) el.textContent = msg; };
function scheduleSave(job, delay = 800) {
  clearTimeout(saveTimer);
  pending = job;
  saveTimer = setTimeout(flushSave, delay);
}
function flushSave() {
  clearTimeout(saveTimer);
  const job = pending; pending = null;
  if (job) saving = saving.then(async () => {
    saveError = '';
    saveStatus('Zapisywanie…');
    try { await job(); S.data = S.fresh || await api('state'); S.fresh = null; saveStatus('Zapisano'); }
    catch (e) { S.fresh = null; saveError = e.message; saveStatus(e.message); }
    // formularz już zamknięty (np. przejście na inną zakładkę) — pokaż zapisany stan
    if (!pending && S.data?.user && !$('.wish-form, .letter-form')) render();
  });
  return saving;
}
// najpierw dokończ zapis, potem przerysuj — żeby nie pokazać na chwilę starej treści
async function settle(fn) { await flushSave(); if (fn() !== false) render(); }
// pola formularza życzenia; null, gdy jeszcze nie ma czego zapisać
function wishValues(form) {
  const v = name => form.querySelector('#f-' + name).value.trim();
  const f = { title: v('title'), note: v('note'), url: v('url'), tier: form.querySelector('[name="tier"]:checked')?.value || '' };
  if (!f.title) { saveStatus(form.dataset.id ? 'Wpisz, co chcesz dostać — wtedy zapiszemy.' : ''); return null; }
  if (!f.tier) { saveStatus('Wybierz, ile może kosztować — wtedy zapiszemy.'); return null; }
  if (f.url && !/^[a-z][a-z0-9+.-]*:/i.test(f.url)) f.url = 'https://' + f.url;  // „allegro.pl/…” też działa
  return f;
}
// nowe życzenie powstaje przy pierwszym zapisie, kolejne zapisy już je tylko zmieniają
function queueWish(form) {
  const f = wishValues(form);
  if (!f) { clearTimeout(saveTimer); pending = null; return; }
  scheduleSave(async () => {
    if (form.dataset.id) return api(`wishes/${form.dataset.id}`, 'PATCH', f);
    const { id } = await api('wishes', 'POST', { ...f, ownerId: form.dataset.owner });
    form.dataset.id = id; S.adding = null; S.editWish = id;
    const del = form.querySelector('[data-act="delete-wish"]');
    if (del) { del.dataset.id = id; del.hidden = false; }
  });
}
// kilka prezentów w jednym życzeniu: wyliczanka w tytule albo wypunktowana lista we wskazówkach
const looksLikeMany = form => /[,;+]/.test(form.querySelector('#f-title').value)
  || (form.querySelector('#f-note').value.match(/^\s*([-–•*]|\d+[.)])\s/gm) || []).length >= 2;
const grow = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'f-letter') {
    const owner = t.dataset.owner, letter = t.value.trim();
    grow(t);
    scheduleSave(() => api(`members/${owner}/letter`, 'PATCH', { letter }));
  } else if (t.closest('.wish-form')) {
    const form = t.closest('.wish-form');
    if (t.id === 'f-title' || t.id === 'f-note') form.querySelector('.many').hidden = !looksLikeMany(form);
    queueWish(form);
  }
});
// wyjście z pola zapisuje od razu
document.addEventListener('focusout', e => { if (pending && e.target.closest?.('.wish-form, .letter-form')) flushSave(); });
addEventListener('pagehide', flushSave);

/* ===================== DEMO =====================
   Przykładowa rodzina żyje w demo.js — pobierana dopiero po kliknięciu „Zobacz przykład”. */
let demoApi = null;
async function startDemo() {
  try { demoApi = (await import('./demo.js')).createDemo(); } catch { return toast('Brak połączenia. Spróbuj ponownie.', true); }
  S.demo = true; S.open.clear();
  act(async () => { S.screen = 'lists'; history.replaceState(null, '', '#/'); window.scrollTo(0, 0); }, 'Przykładowa rodzina — patrzysz jako Ania');
}
function endDemo() {
  S.demo = false; demoApi = null; S.data = { user: null }; S.admin = null; S.open.clear();
  go('landing');
}

/* ===================== WIDOKI ===================== */
// Pole z widoczną etykietą — podpowiedź w środku pola znika przy pisaniu, etykieta zostaje.
const field = (label, control) => `<label class="field"><span>${label}</span>${control}</label>`;
const passField = (label, auto, min = true) => field(label, `<input class="in" name="password" type="password" ${min ? 'minlength="4"' : ''} required autocomplete="${auto}">`)
  + '<button type="button" class="a quiet" data-act="show-pass">Pokaż hasło</button>';
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
  const fams = S.data.families || [];
  const mode = god() ? `<p class="demo-bar mode-bar">Tryb organizatora do ${until}: widzisz, kto co kupuje, i możesz zmieniać listy innych. <button data-act="admin-mode">Wyłącz</button></p>` : '';
  return `<div class="topbar">${bar}${mode}<header class="head">
    <nav class="nav" aria-label="Nawigacja">${tab('lists', 'Listy')}${myRes().length || S.screen === 'buying' ? tab('buying', 'Kupuję') : ''}${tab('mine', 'Moje')}${me().isAdmin ? tab('family', 'Rodzina') : ''}</nav>
    <div class="right">${themeBtn()}<button class="who" data-act="menu" aria-expanded="${S.menu}">${esc(me().name)}</button></div>
  </header>
  <div class="menu ${S.menu ? 'open' : ''}"><div>
    ${fams.length > 1 ? `<div class="fams" aria-label="Twoje rodziny">${fams.map(f => f.memberId === me().id
      ? `<button aria-current="true">${esc(f.name)}${f.isAdmin ? '<small>organizator</small>' : ''}</button>`
      : `<button data-act="switch" data-id="${f.memberId}">${esc(f.name)}${f.isAdmin ? '<small>organizator</small>' : ''}</button>`).join('')}</div>` : ''}
    ${me().isAdmin ? `<button data-act="admin-mode">${god() ? 'Wyłącz tryb organizatora' : 'Tryb organizatora'}</button>` : ''}
    ${S.demo || !S.data.register ? '' : '<button data-go="newfam">Nowa rodzina</button>'}
    ${S.data.mail ? `<button data-act="mails">${me().mails ? 'Wyłącz przypomnienia mailem' : 'Włącz przypomnienia mailem'}</button>` : ''}
    ${fams.length > 1 ? '<button data-act="leave">Opuść rodzinę</button>' : ''}
    <button data-act="logout">Wyloguj</button>
    ${S.confirm?.act === 'leave' ? confirmBox('leave', '', `Opuścić rodzinę ${esc(S.data.family?.name)}? Znikną Twój list i życzenia w tej rodzinie, a prezenty, które kupujesz, znów będą wolne${managedBy(me().id).length ? ', a osoby, które prowadzisz, przejdą do organizatora' : ''}. Wrócić możesz tylko z nowym zaproszeniem.`, 'Opuść') : ''}
  </div></div></div>`;
}

// życzenie zmieniło się, odkąd je kupuję — żeby nie kupić czegoś innego, niż było na liście
const changed = w => (w.prevTitle ? `<span class="changed">Życzenie zmieniło się, odkąd je kupujesz — wcześniej: ${esc(w.prevTitle)}.</span>` : '')
  + (w.prevTier ? `<span class="changed">Budżet zmienił się, odkąd to kupujesz — wcześniej ${tier(w.prevTier).range}.</span>` : '');
function vGift(w) {
  const st = status(w);
  let row;
  if (st === 'free') row = `<button class="a solid" data-act="reserve" data-id="${w.id}">Kupię to</button>`;
  else if (st === 'mine') row = `<span class="st">${w.purchased ? 'Kupione przez Ciebie' : 'Ty to kupujesz'}</span>
    <button class="a quiet" data-act="${w.purchased ? 'buy' : 'cancel'}" data-id="${w.id}">${w.purchased ? 'Cofnij zakup' : 'Rezygnuję'}</button>`;
  else row = `<span class="st">${w.buyerId ? `${w.purchased ? 'Kupione' : 'Kupuje'}: ${esc(member(w.buyerId)?.name)}` : w.purchased ? 'Już kupione' : 'Ktoś już to kupuje'}</span>`;
  let assign = '';
  if (god() && S.assign === w.id) assign = `<div class="row">
      <label class="sr" for="f-buyer">Kto kupuje</label>
      <select class="in" id="f-buyer"><option value="">Nikt — prezent wolny</option>${accountsBut(w.ownerId).map(a => `<option value="${a.id}" ${a.id === (w.buyerId || (w.taken === 'me' ? me().id : '')) ? 'selected' : ''}>Kupuje: ${esc(a.name)}</option>`).join('')}</select>
      <button class="a solid" data-act="assign-save" data-id="${w.id}">Zapisz</button><button class="a quiet" data-act="assign" data-id="">Anuluj</button></div>`;
  else if (god()) row += `<button class="a quiet" data-act="assign" data-id="${w.id}">Przypisz</button>`;
  return `<div class="gift ${st === 'free' ? '' : 'taken'}">
    <span class="t">${esc(w.title)}</span>
    ${w.note ? `<span class="n">${esc(w.note)}</span>` : ''}
    ${changed(w)}
    <div class="row"><span class="act">${row}</span><span class="meta">${range(w)}${w.url ? `<a class="a quiet lnk" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">${esc(host(w.url))} ↗</a>` : ''}</span></div>
    ${assign}
  </div>`;
}

function vLists() {
  const others = S.data.members.filter(m => m.id !== me().id);
  const d = daysToEve();
  const mine = member(me().id);
  const missing = !wishesOf(mine.id).length ? 'życzeń' : !mine.letter ? 'listu' : '';
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
        ${p.managedBy === me().id ? `<div class="actions mt"><button class="a line" data-go="mine">Zmień życzenia i list</button></div>`
          : god() ? `<div class="actions mt"><button class="a line" data-act="edit-person" data-id="${p.id}">Zmień życzenia i list</button></div>` : ''}
        <p class="end">Koniec listy · <button class="a" data-toggle="p:${p.id}">Zwiń</button></p>`;
      return fold('p:' + p.id, 'person', head, body);
    }).join('') : `<p class="empty">Nikogo tu jeszcze nie ma.${me().isAdmin ? '' : ' Organizator może wysłać zaproszenie.'}</p>
      ${me().isAdmin ? '<div class="actions mt"><button class="a solid" data-go="family">Zaproś bliskich</button></div>' : ''}`}
    </div>
  </section>`;
}

// Jedno życzenie = jeden prezent — w testach ktoś wpisał wszystkie prezenty w jedno pole,
// więc formularz mówi to wprost: numer życzenia, etykieta, ostrzeżenie przy liście po przecinku.
// Na wierzchu tylko dwie rzeczy: co i za ile (cena to duże przyciski, nie lista rozwijana); reszta pod „jeśli chcesz”.
function wishForm(w, isNew) {
  return `<div class="form wish-form" data-id="${isNew ? '' : w.id}" data-owner="${w.ownerId}">
    ${isNew ? `<p class="wish-no">Życzenie ${wishesOf(w.ownerId).length + 1}<span>Jeden prezent. Każdy kolejny dodasz osobno — bliscy wybierają je pojedynczo.</span></p>` : ''}
    ${field('Jeden prezent — co to ma być?', `<input class="in" id="f-title" value="${esc(w.title)}" maxlength="160" placeholder="np. ciepły szal">`)}
    <p class="many" hidden>Wygląda na kilka prezentów. Wpisz tu jeden, a kolejne dodaj osobno przyciskiem „Dodaj kolejne” — wtedy bliscy mogą wybrać każdy z osobna.</p>
    <fieldset class="tiers"><legend>Ile może kosztować?</legend><div class="tiers-grid">
      ${TIERS.map(t => `<label class="tier"><input class="sr" type="radio" name="tier" value="${t.id}" ${w.tier === t.id ? 'checked' : ''}><span><b>${t.range}</b><small>${t.name}</small></span></label>`).join('')}
    </div></fieldset>
    <details class="extra" ${w.note || w.url ? 'open' : ''}><summary>Rozmiar, kolor, link do sklepu — jeśli chcesz</summary>
      ${field('Wskazówki — rozmiar, kolor, marka', `<textarea class="in" id="f-note" maxlength="1500">${esc(w.note)}</textarea>`)}
      ${field('Link do sklepu', `<input class="in" id="f-url" value="${esc(w.url)}" placeholder="https://" maxlength="2000" inputmode="url">`)}
    </details>
    <div class="actions">
      <button class="a solid" data-act="done-wish">Gotowe</button>
      ${isNew ? '<button class="a line" data-act="done-wish" data-next="1">Dodaj kolejne</button>' : ''}
      <button class="a line push" data-act="delete-wish" data-id="${isNew ? '' : w.id}" ${isNew ? 'hidden' : ''}>Usuń</button>
    </div>
    ${/* tuż pod przyciskiem „Usuń”, po tej samej stronie — niżej łatwo je przeoczyć */ ''}
    ${!isNew && S.confirm?.act === 'delete-wish' && S.confirm.id === w.id ? confirmBox('delete-wish', w.id, 'Ktoś już to kupuje — lepiej nie usuwać. Jeśli usuniesz, prezent zniknie też z jego zakładki Kupuję.', 'Usuń mimo to', 'Zostaw') : ''}
    <p class="saved" role="status">${isNew ? 'Zapisze się samo, gdy wpiszesz, co i za ile.' : 'Zmiany zapisują się same.'}</p>
  </div>`;
}
// keep: gdy lepiej zrezygnować — wtedy to rezygnacja jest głównym przyciskiem
const confirmBox = (act, id, q, yes, keep) => `<div class="confirm"><p>${q}</p><div class="actions">
  ${keep ? `<button class="a solid" data-act="confirm-cancel">${keep}</button>` : ''}
  <button class="a ${keep ? 'quiet' : 'solid'}" data-act="${act}" data-id="${id || ''}" data-sure="1">${yes}</button>${keep ? '' : '<button class="a quiet" data-act="confirm-cancel">Anuluj</button>'}</div></div>`;

// życzenia + list jednej osoby (mojej albo prowadzonej przeze mnie)
function ownerBlocks(ownerId) {
  const own = ownerId === me().id;
  const m = member(ownerId);
  const ws = wishesOf(ownerId);
  const letterBody = S.editLetter === ownerId
    ? `<div class="form letter-form"><label class="sr" for="f-letter">Treść listu</label>
        <textarea class="in big" id="f-letter" data-owner="${ownerId}" maxlength="4000" placeholder="${own ? 'Drogi Mikołaju, w tym roku…' : `Napisz tak, jak ${esc(m.name)} by to powiedział(a)…`}">${esc(m.letter)}</textarea>
        <p class="hint">${own ? 'Kilka zdań o sobie — co lubisz, a czego nie.' : 'Kilka zdań — co ta osoba lubi, a czego nie.'} Konkretne prezenty dodaj jako życzenia — z nich bliscy wybierają, co kupić.</p>
        <div class="actions"><button class="a solid" data-act="done-letter">Gotowe</button><button class="a line" data-act="add" data-owner="${ownerId}">Dodaj życzenie</button></div>
        <p class="saved" role="status">List zapisuje się sam.</p></div>`
    : m.letter
      ? `<p class="mine-letter"><span class="salut">Drogi Mikołaju,</span> ${esc(m.letter)}</p><div class="actions"><button class="a line" data-act="edit-letter" data-owner="${ownerId}">Edytuj list</button></div>`
      : `<p class="empty">${own ? 'Nie masz jeszcze listu. Dopisz kilka zdań o tym, co lubisz, a czego nie — przyda się, gdy ktoś zechce kupić coś spoza życzeń.' : `${esc(m.name)} nie ma jeszcze listu. Możesz go spisać z rozmowy.`}</p>
         <div class="actions mt"><button class="a line" data-act="edit-letter" data-owner="${ownerId}">Napisz list</button></div>`;
  // opiekun nie jest obdarowanym, więc widzi, co już ktoś kupuje — żeby nie dopisywać dubli
  const stLine = w => !w.taken ? '' : `<span class="st">${w.taken === 'me' ? 'Ty to kupujesz' : w.purchased ? 'Już kupione' : 'Ktoś już to kupuje'}</span>`;
  const wishesBody = `
    ${ws.length || S.adding === ownerId ? '' : `<p class="empty">${own ? 'Wpisz, co chcesz dostać — każdy prezent osobno.' : `Wpisz, co chce dostać ${esc(m.name)} — każdy prezent osobno.`} Bliscy wybiorą z tej listy, co kupić.</p>`}
    <p class="priv">${own ? 'Nie widzisz, co już ktoś dla Ciebie kupuje.' : 'Widzisz, co inni już kupili z tej listy. Nie zdradź niespodzianki.'}</p>
    ${byTier(ws, w => S.editWish === w.id ? wishForm(w, false) : `<div class="gift">
      <span class="t">${esc(w.title)}</span>
      ${w.note ? `<span class="n">${esc(w.note)}</span>` : ''}
      <div class="row"><span class="act"><button class="a line" data-edit="${w.id}">Zmień</button>${stLine(w)}</span><span class="meta">${range(w)}${w.url ? `<span class="st lnk">${esc(host(w.url))}</span>` : ''}</span></div>
    </div>`)}
    ${S.adding === ownerId ? wishForm({ title: '', note: '', url: '', tier: '', ownerId }, true)
      : `<div class="actions mt"><button class="a solid" data-act="add" data-owner="${ownerId}">${ws.length ? 'Dodaj życzenie' : 'Dodaj pierwsze życzenie'}</button></div>`}`;
  // czyja to lista, mówi przyklejone imię nad sekcjami
  // najpierw życzenia — to z nich bliscy wybierają prezenty; list jest dopowiedzeniem
  return fold(secKey('wishes', ownerId), 'sec', `<h2>Życzenia${ws.length ? ` · ${ws.length}` : ''}</h2>`, wishesBody)
       + fold(secKey('letter', ownerId), 'sec', '<h2>List</h2>', letterBody);
}

// Kupuję — osobna zakładka: co wybrałem dla innych, pogrupowane według obdarowanych
function vBuying() {
  const res = myRes();
  const bought = res.filter(w => w.purchased).length;
  const item = w => `<div class="gift ${w.purchased ? 'done' : ''}">
      <span class="t">${esc(w.title)}</span>
      ${w.note ? `<span class="n">${esc(w.note)}</span>` : ''}
      ${changed(w)}
      <div class="row"><span class="act">
        <button class="a ${w.purchased ? 'quiet' : 'line'}" data-act="buy" data-id="${w.id}">${w.purchased ? 'Cofnij zakup' : 'Oznacz jako kupione'}</button>
        <button class="a quiet" data-act="cancel" data-id="${w.id}">Rezygnuję</button></span>
        <span class="meta">${range(w)}${w.url ? `<a class="a quiet lnk" href="${esc(w.url)}" target="_blank" rel="noopener noreferrer">${esc(host(w.url))} ↗</a>` : ''}</span>
      </div>
    </div>`;
  const groups = S.data.members.filter(m => res.some(w => w.ownerId === m.id)).map(m => {
    const ws = res.filter(w => w.ownerId === m.id);
    return `<div class="managed">
      <div class="managed-head">
        <h2 class="managed-name stick">${esc(m.name)}</h2>
        <p class="sub">${ws.filter(w => w.purchased).length} z ${ws.length} kupione</p>
      </div>
      <div class="managed-body">${byTier(ws, item)}</div>
    </div>`;
  }).join('');
  return `${vHead()}<section class="fade">
    <h1 class="title">Kupuję</h1>
    <p class="sub">${res.length ? `${bought} z ${res.length} kupione · ` : ''}Twoje zakupy. Organizator może je zobaczyć w trybie organizatora.</p>
    ${res.length ? groups : `<p class="empty mt">Nic jeszcze nie kupujesz.</p><div class="actions mt"><button class="a line" data-go="lists">Przejrzyj listy</button></div>`}
  </section>`;
}

// Moje — moje życzenia i list oraz osoby, które prowadzę; każda osoba z przyklejonym imieniem.
// Dodanie osoby to rzadka, poboczna akcja — jedna cicha linijka na samym dole, daleko od list.
function vMine() {
  const managed = managedBy(me().id);
  const block = (m, sub = '', extra = '') => `
    <div class="managed">
      <div class="managed-head">
        <h2 class="managed-name stick">${esc(m.name)}</h2>
        ${sub ? `<p class="sub">${sub}</p>` : ''}
        ${extra}
      </div>
      <div class="managed-body">${ownerBlocks(m.id)}</div>
    </div>`;
  const managedHtml = managed.map(m => block(m, 'Bez konta — życzenia i list wpisujesz Ty.', `
        <div class="actions managed-actions">
          <button class="a quiet" data-act="person-link" data-id="${m.id}">Przekaż listę tej osobie</button>
          <button class="a quiet" data-act="remove-person" data-id="${m.id}">Usuń osobę</button>
        </div>
        ${S.confirm?.act === 'remove-person' && S.confirm.id === m.id ? confirmBox('remove-person', m.id, `Usunąć: ${esc(m.name)}? Zniknie list i życzenia tej osoby.`, 'Usuń') : ''}`)).join('');

  const addPerson = S.addingPerson
    ? `<div class="add-person"><div class="form">
        ${field('Imię, np. Zosia albo Babcia Hela', '<input class="in" id="f-person" maxlength="60">')}
        <div class="actions"><button class="a solid" data-act="save-person">Dodaj osobę</button><button class="a quiet" data-act="cancel-person">Anuluj</button></div>
      </div></div>`
    : `<p class="add-person sub">Ktoś bez telefonu? <button class="a" data-act="add-person">Dodaj osobę</button> i wpisuj życzenia za nią.</p>`;

  return `${vHead()}<section class="fade">
    <h1 class="title">Moje</h1>
    <div class="own">${block(member(me().id))}</div>
    ${managedHtml}
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
      const you = b.id === me().id ? ' <span class="you">(Ty)</span>' : '';
      if (!rs.length) return `<div class="res-group"><h3>${esc(b.name)}${you}</h3><p class="empty">Nic jeszcze nie kupuje.</p></div>`;
      return `<div class="res-group"><h3>${esc(b.name)}${you}<span>${rs.filter(r => r.purchased).length} z ${rs.length} kupione</span></h3>
        ${rs.map(r => resRow(r, `dla: ${name(r.ownerId)}`)).join('')}
        </div>`;
    }).join('');
  } else {
    resHtml = A.members.filter(m => m.id !== me().id).map(m => {
      const total = wishesOf(m.id).length;
      const rs = A.reservations.filter(r => r.ownerId === m.id);
      return `<div class="res-group"><h3>${esc(m.name)}<span>${rs.length} z ${total} ktoś kupuje</span></h3>
        ${rs.length ? rs.map(r => resRow(r, `kupuje ${name(r.buyerId)}`)).join('') : '<p class="empty">Nikt jeszcze nic nie wybrał.</p>'}</div>`;
    }).join('') + `<p class="priv mt">Twojej listy tu nie ma — żeby nie zepsuć Ci niespodzianki.</p>`;
  }

  const confirming = (act, id) => S.confirm?.act === act && S.confirm.id === id;
  const people = A.members.slice().sort((a, b) => (a.id === me().id ? -1 : b.id === me().id ? 1 : 0) || (!!a.managedBy - !!b.managedBy));
  const row = m => {
    const own = m.id === me().id, open = S.fam === m.id;
    const meta = m.managedBy ? `bez konta · prowadzi ${name(m.managedBy)}`
      : [esc(m.email), m.isAdmin ? 'organizator' : ''].filter(Boolean).join(' · ');
    let actions = '';
    const editBtn = own || !god() ? '' : `<button class="a line" data-act="edit-person" data-id="${m.id}">Edytuj życzenia i list</button>`;
    if (open && !m.managedBy) actions = `<div class="fam-actions">
        ${editBtn}
        ${own ? '' : `<button class="a" data-act="make-admin" data-id="${m.id}">Przekaż rolę organizatora</button>
        <button class="a quiet" data-act="remove-member" data-id="${m.id}">Usuń z rodziny</button>`}
      </div>
      ${confirming('make-admin', m.id) ? confirmBox('make-admin', m.id, `${esc(m.name)} zostanie organizatorem. Ty stracisz dostęp do tej zakładki.`, 'Przekaż') : ''}
      ${confirming('remove-member', m.id) ? confirmBox('remove-member', m.id, `${esc(m.name)} straci dostęp. Znikną list i życzenia tej osoby, a prezenty, które kupuje, znów będą wolne.${A.members.some(x => x.managedBy === m.id) ? ' Osoby, które prowadzi, przejdą do Ciebie.' : ''}`, 'Usuń') : ''}`;
    if (open && m.managedBy) actions = `<div class="fam-actions">
        ${editBtn}
        ${field('Kto prowadzi tę listę', `<select class="in" id="f-manager">${accounts.map(a => `<option value="${a.id}" ${a.id === m.managedBy ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>`)}
        <button class="a" data-act="save-manager" data-id="${m.id}">Zapisz, kto prowadzi</button>
        <button class="a" data-act="person-link" data-id="${m.id}">Przekaż listę tej osobie</button>
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
  const who = A.locked ? `<h2 class="label">Kto co kupuje</h2>
    <p class="fam-text">Widać to tylko w trybie organizatora — żeby nikt przypadkiem nie zobaczył cudzych niespodzianek.</p>
    <div class="actions mt"><button class="a line" data-act="admin-mode">Włącz tryb organizatora</button></div>` : `<h2 class="label">Kto co kupuje</h2>
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
    ${S.confirm?.act === 'new-invite' ? confirmBox('new-invite', '', 'Stary link przestanie działać. Osoby, które już dołączyły, zostają.', 'Utwórz nowy') : ''}
    ${S.data.mail ? `<form class="form mt" data-form="invite-mail">
      ${field('Albo wyślij zaproszenie mailem — wpisz adres', '<input class="in" name="email" type="email" required>')}
      <div class="actions"><button class="a line">Wyślij zaproszenie</button></div></form>` : ''}`;
  const rename = `<h2 class="label">Nazwa rodziny</h2>
    <form class="form" data-form="rename"><label class="sr" for="f-family-name">Nazwa rodziny</label>
      <input class="in" id="f-family-name" name="name" value="${esc(S.data.family?.name)}" maxlength="80" required>
      <div class="actions"><button class="a line">Zmień nazwę</button></div></form>`;
  const addPeople = `<h2 class="label">Dodaj osoby</h2>
    <p class="fam-text">Wpisz imiona, każde w osobnej linii. Te osoby nie mają konta — prowadzisz je Ty. Potem możesz przekazać komuś jego listę — dostanie link, ustawi e-mail i hasło i będzie ją prowadzić sam — albo wskazać, kto inny ją prowadzi.</p>
    <div class="form"><label class="sr" for="f-people">Imiona</label>
      <textarea class="in" id="f-people" placeholder="${'Babcia Hela&#10;Dziadek Jurek&#10;Zosia'}"></textarea>
      <div class="actions"><button class="a solid" data-act="add-people">Dodaj osoby</button></div></div>`;
  const mode = `<h2 class="label">Tryb organizatora</h2>
    <p class="fam-text">Na wszelki wypadek: widzisz, kto co kupuje, zmieniasz listy i życzenia innych osób i przypisujesz za nich prezenty. Włącza się tylko w tej sesji i wyłącza sam po godzinie. Twojej listy nadal nie widzisz.</p>
    <div class="actions mt">${god() ? '<button class="a line" data-act="admin-mode">Wyłącz tryb organizatora</button>' : '<button class="a solid" data-act="admin-mode">Włącz na godzinę</button>'}</div>`;
  return `${vHead()}<section class="fade">
    <h1 class="title">Rodzina</h1>
    <p class="sub">Tę zakładkę widzisz tylko Ty, bo jesteś organizatorem.</p>
    <div class="split fam-split ${A.reservations.length ? '' : 'fresh'}">
      <div class="split-main">${who}
        <h2 class="label">Osoby · ${A.members.length}</h2>
        ${people.map(row).join('')}</div>
      <aside class="split-side">${invite}${addPeople}${mode}${rename}</aside>
    </div>
  </section>`;
}

// kolejna rodzina na tym samym koncie: nowa albo z zaproszenia
function vNewFamily() {
  const join = S.screen === 'joinfam', I = S.info || {};
  return `${vHead()}<section class="auth fade">
    <h1 class="title">${join ? 'Zaproszenie' : 'Nowa rodzina'}</h1>
    <p class="sub">${join
      ? `${I.from ? esc(I.from) + ' zaprasza' : 'Zapraszamy'} Cię do rodziny ${esc(I.familyName)}. Dołączysz tym samym kontem — w każdej rodzinie masz osobny list i życzenia, a między rodzinami przełączasz się pod swoim imieniem.`
      : 'Zostajesz jej organizatorem. Obecne rodziny zostają — przełączasz się między nimi pod swoim imieniem.'}</p>
    <form class="form" data-form="${S.screen}">
      ${join ? '' : field('Nazwa rodziny, np. Kowalscy', '<input class="in" name="familyName" maxlength="80" required>')}
      ${field('Twoje imię w tej rodzinie', `<input class="in" name="name" value="${esc(me().name)}" maxlength="60" required autocomplete="given-name">`)}
      <div class="actions"><button class="a solid">${join ? 'Dołączam' : 'Załóż rodzinę'}</button><button type="button" class="a quiet" data-act="cancel-fam">Anuluj</button></div>
    </form>
  </section>`;
}

// organizator w swoim trybie edytuje listę innej osoby
function vEdit() {
  const m = member(S.editOwner);
  if (!m || !god()) { S.screen = 'family'; return vFamily(); }
  return `${vHead()}<section class="fade">
    <div class="actions"><button class="a quiet" data-go="${S.editFrom === 'lists' ? 'lists' : 'family'}">← ${S.editFrom === 'lists' ? 'Listy' : 'Rodzina'}</button></div>
    <h1 class="title mt">${esc(m.name)}</h1>
    <p class="sub">Zmieniasz jako organizator. ${esc(m.name)} zobaczy zmiany na swojej liście.</p>
    ${ownerBlocks(m.id)}
  </section>`;
}

const MARK = '<button class="mark" data-go="landing" aria-label="Mikołaj — strona główna"><img src="/mark.webp" alt="" width="36" height="36"></button>';
const PUB = () => `<div class="topbar"><header class="head pub">${MARK}${themeBtn()}</header></div>`;
function vAuth() {
  const I = S.info || {};
  const mail = (label = 'E-mail', value = '') => field(label, `<input class="in" name="email" type="email" value="${esc(value)}" required autocomplete="email">`);
  // zaproszenie mailem niesie adres — wpisany od razu, do zmiany
  const account = `${field('Twoje imię', '<input class="in" name="name" maxlength="60" required autocomplete="given-name">')}
      ${mail('E-mail — posłuży do logowania', S.screen === 'join' ? S.prefill : '')}
      ${passField('Hasło — co najmniej 4 znaki', 'new-password')}`;
  if (S.screen === 'register') return `${PUB()}<section class="auth fade">
    <h1 class="title">Załóż rodzinę</h1>
    <p class="sub">Zostajesz organizatorem: zapraszasz bliskich linkiem i możesz dodać osoby bez telefonu.</p>
    <form class="form" data-form="register">
      ${field('Nazwa rodziny, np. Kowalscy', '<input class="in" name="familyName" maxlength="80" required>')}
      ${account}
      <div class="actions"><button class="a solid">Załóż rodzinę</button></div>
    </form>
    <p class="foot">Masz już konto? <button class="a" data-go="login">Zaloguj się</button></p>
  </section>`;
  if (S.screen === 'join') return `${PUB()}<section class="auth fade">
    <h1 class="title">Zaproszenie</h1>
    <p class="sub">${I.from ? esc(I.from) + ' zaprasza' : 'Zapraszamy'} Cię do rodziny ${esc(I.familyName)} — do wspólnych list do Mikołaja.</p>
    <form class="form" data-form="join">
      ${account}
      <div class="actions"><button class="a solid">Dołączam</button></div>
    </form>
    <p class="foot">Masz już konto w innej rodzinie? Wpisz ten sam e-mail i hasło — dołączysz tym samym kontem.</p>
  </section>`;
  if (S.screen === 'link') return `<section class="auth fade">
    <h1 class="title">Cześć, ${esc(I.name)}</h1>
    <p class="sub">${I.needsEmail ? 'Ustaw e-mail i hasło — od teraz sam(a) prowadzisz swoją listę.' : 'Ustaw nowe hasło.'}</p>
    <form class="form" data-form="link">
      ${I.needsEmail ? mail('E-mail — posłuży do logowania') : ''}
      ${passField('Nowe hasło — co najmniej 4 znaki', 'new-password')}
      <div class="actions"><button class="a solid">Zapisz</button></div>
    </form>
    ${I.needsEmail ? '<p class="foot">Masz już konto w innej rodzinie? Wpisz ten sam e-mail i hasło — lista dołączy do Twojego konta.</p>' : ''}
  </section>`;
  if (S.screen === 'forgot') return `${PUB()}<section class="auth fade">
    <h1 class="title">Nowe hasło</h1>
    <p class="sub">Podaj e-mail swojego konta — wyślemy link do ustawienia nowego hasła.</p>
    <form class="form" data-form="forgot">
      ${mail()}
      <div class="actions"><button class="a solid">Wyślij link</button><button type="button" class="a quiet" data-go="login">Wróć do logowania</button></div>
    </form>
  </section>`;
  if (S.screen !== 'login') return vLanding();
  return `${PUB()}<section class="auth fade">
    <h1 class="title">Zaloguj się</h1>
    <p class="sub">Do rodzinnych list do Mikołaja.</p>
    <form class="form" data-form="login">
      ${mail()}
      ${passField('Hasło', 'current-password', false)}
      <div class="actions"><button class="a solid">Zaloguj się</button></div>
    </form>
    <p class="foot">Nie masz konta? ${S.data?.register === false ? 'Poproś bliskich o link zaproszenia.' : '<button class="a" data-go="register">Załóż rodzinę</button> albo poproś bliskich o link zaproszenia.'}
      ${S.data?.mail ? 'Nie pamiętasz hasła? <button class="a" data-go="forgot">Wyślemy link</button>' : 'Zapomniane hasło? Organizator rodziny wyśle Ci nowy link.'}</p>
  </section>`;
}

// strona startowa dla niezalogowanych — jej treść leży gotowa w index.html (pierwsze malowanie bez czekania na JS)
const LANDING = $('#app').innerHTML;
function vLanding() {
  const t = document.createElement('template');
  t.innerHTML = LANDING;
  const d = daysToEve();
  t.content.querySelector('[data-eve]').textContent = d ? `${d} ${pl(d, 'dzień', 'dni', 'dni')} do Wigilii` : 'Dziś Wigilia';
  t.content.querySelector('.theme').outerHTML = themeBtn();
  t.content.querySelector('.landing').classList.add('fade');
  // instalacja dla jednej rodziny: nowych się nie zakłada, dołącza się z zaproszenia
  if (S.data?.register === false) t.content.querySelectorAll('[data-go="register"]').forEach(b => b.remove());
  return t.innerHTML;
}

/* ===================== RENDER ===================== */
let modeTimer;
function scheduleModeEnd() {
  clearTimeout(modeTimer);
  if (S.data?.user && god()) modeTimer = setTimeout(() => act(async () => {}, 'Tryb organizatora wyłączył się'), me().adminUntil * 1000 - Date.now() + 500);
}
const TABS = { lists: '#/', buying: '#/kupuje', mine: '#/moje', family: '#/rodzina' };
const PUBLIC = { landing: '#/', login: '#/zaloguj', register: '#/zaloz', forgot: '#/haslo' };
function render(animate = false) {
  const y = window.scrollY;
  const loggedIn = S.data?.user;
  if (loggedIn && !TABS[S.screen] && !['edit', 'newfam', 'joinfam'].includes(S.screen)) S.screen = 'lists';
  if (S.screen === 'joinfam' && !S.token) S.screen = 'lists';
  if (!loggedIn && !['login', 'register', 'join', 'link', 'forgot'].includes(S.screen)) S.screen = 'landing';
  if ((S.screen === 'family' || S.screen === 'edit') && !me()?.isAdmin) S.screen = 'lists';
  scheduleModeEnd();
  const view = !loggedIn ? vAuth() : { lists: vLists, buying: vBuying, mine: vMine, family: vFamily, edit: vEdit, newfam: vNewFamily, joinfam: vNewFamily }[S.screen]();
  const el = $('#app');
  if (el.classList.contains('pre')) {
    // pierwszy render: gotowa strona startowa już widać — bez ponownego wjazdu
    if (S.screen === 'landing' && !el.hidden && !document.documentElement.classList.contains('deep')) animate = false;
    el.classList.remove('pre');
    el.hidden = false;
    document.documentElement.classList.remove('deep');
  }
  el.innerHTML = view;
  if (!animate) { $('.fade')?.classList.remove('fade'); window.scrollTo(0, y); }
  if (S.confirm) $('.confirm')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });  // pytanie zawsze w kadrze
  markFits();
  syncTop();
  syncAll();
}
// po przełączeniu rodziny: czysty stan widoku
function enterFamily(screen = 'lists') {
  Object.assign(S, { screen, menu: false, editWish: null, adding: null, editLetter: null, addingPerson: false, fam: null, confirm: null, assign: null, filter: {}, admin: null });
  S.open.clear();
  history.replaceState(null, '', TABS[screen]);
  window.scrollTo(0, 0);
}
const fromHash = () => Object.keys(PUBLIC).find(k => k !== 'landing' && PUBLIC[k] === location.hash) || Object.keys(TABS).find(k => TABS[k] === location.hash) || 'lists';
function go(screen, push = true) {
  flushSave();
  Object.assign(S, { screen, menu: false, editWish: null, adding: null, editLetter: null, addingPerson: false, fam: null, confirm: null, assign: null });
  const hash = (S.data?.user ? TABS : PUBLIC)[screen];
  // każdy ekran to wpis w historii — przycisk Wstecz wraca do poprzedniego, zamiast zamykać aplikację
  if (hash && push && location.hash !== hash) history.pushState(null, '', hash);
  window.scrollTo(0, 0);
  render(true);
  if (screen === 'family') act(() => {});
}
// sekcje, które mieszczą się w podglądzie, nie potrzebują „Rozwiń”
// wysokość przyklejonego paska u góry — inne przyklejone nagłówki stają tuż pod nim
const topOffset = () => [...($('.topbar')?.children || [])].filter(e => !e.classList.contains('menu')).reduce((h, e) => h + e.offsetHeight, 0);
function syncTop() { document.documentElement.style.setProperty('--top', topOffset() + 'px'); }
addEventListener('resize', syncTop);
addEventListener('popstate', () => { if (booted) go(fromHash(), false); });
function markFits() {
  // zwinięta osoba na Listach: widać list (dwie linijki) i całe pierwsze życzenie, dalej lista gaśnie
  document.querySelectorAll('.person').forEach(f => {
    const g = f.querySelector('.gift'), inner = f.querySelector('.peek-inner');
    if (!g) return f.style.removeProperty('--peek');
    let h = g.getBoundingClientRect().bottom - inner.getBoundingClientRect().top;
    const l = f.classList.contains('open') && f.querySelector('.letter');  // rozwinięta — list nieprzycięty
    if (l) h -= l.offsetHeight - Math.min(l.offsetHeight, 2 * parseFloat(getComputedStyle(l).lineHeight));
    f.style.setProperty('--peek', Math.ceil(h) + 48 + 'px');
  });
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
const wide = () => matchMedia('(min-width: 1100px)').matches;
function toggleFold(key, bulk = false) {
  const f = document.querySelector(`[data-fold="${key}"]`);
  if (!f || f.classList.contains('fits') || wide()) return;
  const peek = f.querySelector('.peek');
  const open = !S.open.has(key);
  open ? S.open.add(key) : S.open.delete(key);
  f.querySelectorAll('[data-toggle]').forEach(b => b.setAttribute('aria-expanded', open));
  if (open) {
    // od obecnej wysokości do pełnej — po rozwinięciu list już nie jest przycięty, więc mierzymy z klasą open
    peek.style.maxHeight = peek.offsetHeight + 'px';
    f.classList.add('open');
    peek.offsetHeight;
    peek.style.maxHeight = peek.scrollHeight + 'px';
    peek.addEventListener('transitionend', () => { if (S.open.has(key)) peek.style.maxHeight = ''; }, { once: true });
  } else {
    // nagłówek przyklejony w głębi listy — wróć do początku sekcji
    const top = f.getBoundingClientRect().top - topOffset();
    if (top < 0 && !bulk) window.scrollBy(0, top);
    peek.style.maxHeight = peek.scrollHeight + 'px';
    peek.offsetHeight;
    f.classList.remove('open');
    peek.style.maxHeight = '';
  }
}

let toastTimer;
// Zwykły komunikat znika sam (dłuższy tekst — później); błąd zostaje, aż ktoś go zamknie.
// Bez „Cofnij” — przycisk w komunikacie wyglądał jak potwierdzenie i bywał klikany przypadkiem.
function toast(msg, sticky = false) {
  $('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast'; el.setAttribute('role', sticky ? 'alert' : 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${sticky ? '<button data-act="close-toast">Zamknij</button>' : ''}`;
  document.body.appendChild(el);
  if (!sticky) toastTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 200); }, Math.max(5000, msg.length * 80));
}
const focusFirst = () => setTimeout(() => $('.form .in')?.focus(), 0);
// pisany list u góry ekranu, kursor na końcu
function openLetter() {
  const t = $('#f-letter'); if (!t) return;
  grow(t);
  t.closest('.fold')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  t.focus({ preventScroll: true });
  t.setSelectionRange(t.value.length, t.value.length);
}
function setTheme(t) {
  theme = t;
  try { localStorage.setItem('mikolaj.theme', t); } catch {}
  t === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t);
  // pasek systemowy telefonu w kolorze tła
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = isDark() ? '#161616' : '#ffffff'; });
}

/* ===================== ZDARZENIA ===================== */
// Gotowa strona startowa jest klikalna, zanim start() dostanie stan z serwera — takie
// kliknięcie zapamiętuje skrypt w index.html, a start() powtarza je, zamiast je nadpisać.
let booted = false;
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-toggle],[data-edit],[data-act],[data-filter]');
  if (!t) return;
  const d = t.dataset;
  if (!booted) return;
  pressed = t; queueMicrotask(() => { pressed = null; });
  if (d.go) return go(d.go);
  if (d.toggle) { toggleFold(d.toggle); return syncAll(); }
  if (d.edit) return settle(() => { S.editWish = d.edit; S.adding = null; S.editLetter = null; S.confirm = null; S.open.add(secKey('wishes', wish(d.edit).ownerId)); }).then(focusFirst);
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
    case 'theme': setTheme(isDark() ? 'light' : 'dark'); t.outerHTML = themeBtn(); return;
    case 'demo': return startDemo();
    case 'end-demo': return endDemo();
    case 'logout': if (S.demo) return endDemo(); return act(async () => { await api('logout', 'POST'); S.screen = 'landing'; history.replaceState(null, '', '#/'); }, null);
    case 'confirm-cancel': S.confirm = null; return render();
    case 'switch': {
      const f = (S.data.families || []).find(x => x.memberId === id);
      return act(async () => { await api('switch', 'POST', { memberId: id }); enterFamily(); }, f ? `Rodzina: ${f.name}` : null); }
    case 'leave':
      if (me().isAdmin) return toast('Jesteś tu organizatorem — najpierw przekaż tę rolę w zakładce Rodzina.');
      if (!d.sure) { S.confirm = { act: 'leave' }; return render(); }
      return act(async () => { await api('leave', 'POST'); enterFamily(); }, `Opuszczono rodzinę. Teraz: ${(S.data.families || []).find(f => f.memberId !== me().id)?.name || ''}`);
    case 'cancel-fam': S.token = null; S.info = null; return go('lists');
    case 'close-toast': return $('.toast')?.remove();
    case 'show-pass': {
      const input = t.closest('form').querySelector('[name="password"]'), show = input.type === 'password';
      input.type = show ? 'text' : 'password'; t.textContent = show ? 'Ukryj hasło' : 'Pokaż hasło'; return; }
    case 'mails': { const on = !me().mails; return act(() => api('account', 'PATCH', { mails: on }), on ? 'Przypomnienia mailem włączone' : 'Nie będziemy wysyłać przypomnień mailem'); }

    // rezerwacje
    case 'reserve': return act(() => api(`wishes/${id}/reserve`, 'POST'), 'Kupujesz to — znajdziesz to w zakładce Kupuję');
    case 'buy': { const p = !wish(id).purchased; return act(() => api(`wishes/${id}/reserve`, 'PATCH', { purchased: p }), p ? 'Oznaczone jako kupione' : null); }
    case 'cancel': return act(() => api(`wishes/${id}/reserve`, 'DELETE'), 'Prezent znów jest wolny');

    // życzenia i listy
    case 'add': return settle(() => { S.adding = d.owner; S.editWish = null; S.editLetter = null; S.confirm = null; S.open.add(secKey('wishes', d.owner)); })
      .then(() => { $('.wish-form')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); focusFirst(); });
    case 'done-wish': {
      const form = t.closest('.wish-form');
      if (!form.dataset.id && form.querySelector('#f-title').value.trim() && !form.querySelector('[name="tier"]:checked')) {
        saveStatus('Wybierz, ile może kosztować — wtedy zapiszemy.'); return form.querySelector('[name="tier"]').focus(); }
      const next = d.next && form.dataset.owner;
      return settle(() => { if (saveError) return false; S.adding = next || null; S.editWish = null; S.confirm = null; })
        .then(() => { if (next && S.adding) { $('.wish-form')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); focusFirst(); } }); }
    case 'done-letter': return settle(() => { if (saveError) return false; S.editLetter = null; });
    case 'delete-wish':
      // usuwa od razu; pyta tylko wtedy, gdy ktoś już to kupuje — serwer mówi, że ktoś, nie mówi kto
      return act(async () => {
        const r = await api(`wishes/${id}${d.sure ? '' : '?check=1'}`, 'DELETE');
        if (r.reserved) { S.confirm = { act: 'delete-wish', id }; return; }
        S.editWish = null; S.confirm = null; toast('Usunięto');
      });
    case 'edit-letter': return settle(() => { S.editLetter = d.owner; S.adding = null; S.editWish = null; S.confirm = null; S.open.add(secKey('letter', d.owner)); }).then(openLetter);

    // osoby prowadzone
    case 'add-person': S.addingPerson = true; render(); return focusFirst();
    case 'cancel-person': S.addingPerson = false; return render();
    case 'save-person': {
      const name = $('#f-person').value.trim();
      if (!name) return $('#f-person').focus();
      return act(async () => {
        const { id: nid } = await api('members', 'POST', { name });
        S.addingPerson = false; S.adding = nid; S.open.add(secKey('wishes', nid));
      }, `Dodano: ${name}`).then(() => { $('.wish-form')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); focusFirst(); }); }
    case 'remove-person':
      if (!d.sure) { S.confirm = { act: 'remove-person', id }; return render(); }
      return act(async () => { await api(`members/${id}`, 'DELETE'); S.confirm = null; }, 'Usunięto');
    case 'person-link': {
      const m = S.admin?.members.find(x => x.id === id) || member(id);
      return act(async () => {
        const { url } = await api(`members/${id}/link`, 'POST');
        await copy(url, m.managedBy ? `Link skopiowany. Wyślij go: ${m.name} ustawi e-mail i hasło i od tej pory sam(a) prowadzi swoją listę. Link działa 3 dni.` : `Link dla ${m.name} skopiowany. Działa raz, przez 3 dni.`);
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
    case 'edit-person': S.editOwner = id; S.editFrom = S.screen; go('edit'); return;
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
    case 'save-manager': return act(() => api(`members/${id}`, 'PATCH', { managedBy: $('#f-manager').value }), 'Zapisano, kto prowadzi listę');
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
  pressed = e.submitter; queueMicrotask(() => { pressed = null; });
  if (kind === 'rename') {
    const name = body.name.trim();
    if (!name || name === S.data.family?.name) return;
    return act(() => api('family', 'PATCH', { name }), `Nowa nazwa: ${name}`);
  }
  if (kind === 'invite-mail') return act(() => api('invite/email', 'POST', body), `Zaproszenie wysłane na ${body.email}`);
  if (kind === 'newfam' || kind === 'joinfam') return act(async () => {
    const r = await api(kind === 'newfam' ? 'families' : 'families/join', 'POST', kind === 'newfam' ? body : { ...body, inviteToken: S.token });
    S.token = null; S.info = null; enterFamily(kind === 'newfam' ? 'family' : r.already ? 'lists' : 'mine');
  }, kind === 'newfam' ? 'Rodzina założona. Skopiuj link zaproszenia i wyślij go bliskim.' : 'Jesteś w nowej rodzinie');
  if (kind === 'forgot') return act(async () => { await api('forgot', 'POST', body); S.screen = 'login'; history.replaceState(null, '', PUBLIC.login); },
    'Jeśli konto istnieje, wysłaliśmy link. Sprawdź skrzynkę — także spam.');
  act(async () => {
    if (kind === 'login') await api('login', 'POST', body);
    if (kind === 'register') await api('register', 'POST', body);
    if (kind === 'join') await api('join', 'POST', { ...body, inviteToken: S.token });
    if (kind === 'link') await api(`link/${S.token}`, 'POST', body);
    S.token = null; S.info = null;
    S.screen = { join: 'mine', register: 'family' }[kind] || 'lists';
    history.replaceState(null, '', TABS[S.screen]);
    window.scrollTo(0, 0);
  }, kind === 'register' ? 'Rodzina założona. Skopiuj link zaproszenia i wyślij go bliskim.' : null);
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !S.data?.user) return;
  if (S.editWish || S.adding || S.editLetter || S.addingPerson || S.confirm)
    settle(() => { Object.assign(S, { editWish: null, adding: null, editLetter: null, addingPerson: false, confirm: null }); });
});

/* ===================== START ===================== */
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (theme === 'auto') { setTheme(theme); render(); } });
async function start() {
  setTheme(theme);
  const hash = location.hash;
  const token = hash.match(/^#(invite|link|nomail)=([a-f0-9]{64})(?:&email=([^&]+))?$/);
  if (token?.[1] === 'nomail') {
    history.replaceState(null, '', '#/');
    api('mails/off', 'POST', { token: token[2] }).then(() => toast('Nie będziemy już wysyłać przypomnień na ten adres. Włączysz je z powrotem w menu pod swoim imieniem.'), err => toast(err.message, true));
  } else if (token) {
    // Sekret tylko w pamięci — usuń go z paska adresu.
    history.replaceState(null, '', '#/');
    S.token = token[2];
    try { S.prefill = token[3] ? decodeURIComponent(token[3]).slice(0, 254) : ''; } catch {}
    try {
      if (token[1] === 'invite') { S.info = await api(`invitation/${S.token}`); S.screen = 'join'; }
      if (token[1] === 'link') { S.info = await api(`link/${S.token}`); S.screen = 'link'; }
    } catch (err) { S.screen = 'login'; S.token = null; setTimeout(() => toast(err.message, true), 0); }
  }
  if (!token || token[1] === 'nomail') S.screen = fromHash();
  try { await refresh(); } catch (err) { S.data = { user: null }; toast(err.message, true); }
  // Zalogowany z zaproszeniem — dołącza tym samym kontem. Z linkiem do hasła/listy — najpierw link.
  if (S.token && S.data.user && S.screen === 'join') S.screen = 'joinfam';
  else if (S.token && S.data.user) S.data = { user: null };
  render(true);
  const early = window.earlyClick;
  booted = true;
  if (early && !S.data.user && S.screen === 'landing') $(early)?.click();
  if (S.screen === 'family' && S.data.user) act(() => {});
}
start();
