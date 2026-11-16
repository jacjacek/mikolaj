// Zapamiętany motyw na stronach poza aplikacją — przed pierwszym malowaniem.
try { const t = localStorage.getItem('mikolaj.theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch {}
