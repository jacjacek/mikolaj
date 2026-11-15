/* Przykładowa rodzina w pamięci przeglądarki — ten sam kształt danych co /api, bez serwera.
   Zasady jak w backendzie: obdarowany nie widzi, co ktoś kupuje z jego listy. */

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
export function createDemo() {
  const D = demoSeed();
  return (path, method, body = {}) => {
    const me = D.members.find(m => m.id === D.me);
    const fail = msg => { throw new Error(msg); };
    const res = id => D.res.find(r => r.wishId === id);
    const mem = id => D.members.find(m => m.id === id) || fail('Nie znaleziono tej osoby.');
    const canEdit = m => m.id === me.id || m.managedBy === me.id || D.until > Date.now() / 1000;
    const out = v => Promise.resolve(JSON.parse(JSON.stringify(v)));
    const [a, id, sub] = path.split('/');
    if (path === 'state') return out({
      family: { name: D.familyName || 'Nowakowie' },
      user: { id: me.id, name: me.name, email: me.email, isAdmin: me.isAdmin, canAdd: me.canAdd || me.isAdmin, adminUntil: me.isAdmin && D.until > Date.now() / 1000 ? D.until : 0, mails: true },
      mail: false, register: true,
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
      locked: !(D.until > Date.now() / 1000),
      reservations: !(D.until > Date.now() / 1000) ? [] : D.res.map(r => { const w = D.wishes.find(x => x.id === r.wishId); return { wishId: w.id, title: w.title, tier: w.tier, ownerId: w.ownerId, buyerId: r.by, purchased: r.purchased }; }).filter(r => r.ownerId !== me.id),
    });
    if (path === 'session') { D.until = body.adminMode ? Math.floor(Date.now() / 1000) + 3600 : 0; return out({ ok: true }); }
    if (path === 'family') { D.familyName = body.name; return out({ ok: true }); }
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
        if (method === 'POST') { const by = body.buyerId || me.id; if (r && !body.buyerId) fail('Ktoś już to kupuje. Wybierz inny prezent.'); if (r) r.by = by; else D.res.push({ wishId: id, by, purchased: false, was: w.tier }); }
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
  };
}
