#!/usr/bin/env python3
"""Regression: editing a purchased wish must not rewrite the buyer's record."""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

fixtures = json.loads(Path(sys.argv[1]).read_text())
base = fixtures['base']
assert base.startswith('https://mikolaj-preview.') and base.endswith('.workers.dev')


def call(account, path, method='GET', data=None):
    cookies = fixtures['accounts'][account]['cookies']
    headers = {'Origin': base, 'User-Agent': 'Mikolaj-Integration-Test/1.0', 'Cookie': '; '.join(item['name'] + '=' + item['value'] for item in cookies)}
    payload = None
    if method not in ['GET', 'DELETE']:
        headers['Content-Type'] = 'application/json'
        payload = json.dumps(data or {}).encode()
    with urllib.request.urlopen(urllib.request.Request(base + path, data=payload, headers=headers, method=method), timeout=45) as response:
        return json.load(response)


wish = {'title': 'Oryginalna książka', 'note': 'Pierwsze wydanie', 'url': 'https://example.com/book', 'price': 120}
created = call('owner', '/api/wishes', 'POST', wish)
path = '/api/wishes/' + created['id']
try:
    call('buyer', path + '/reserve', 'POST')
    call('buyer', path + '/reserve', 'PATCH', {'purchased': True})
    unchanged = next(w for w in call('buyer', '/api/reservations')['wishes'] if w['id'] == created['id'])
    assert unchanged.get('changedSinceReservation') is False, 'New reservation should not be marked changed'
    call('owner', path, 'PATCH', {**wish, 'title': 'Rower zamiast książki', 'price': 2500})
    reserved = next(w for w in call('buyer', '/api/reservations')['wishes'] if w['id'] == created['id'])
    assert reserved['title'] == wish['title'] and reserved['price'] == wish['price'], 'Original purchase details must survive recipient edit'
    assert reserved['purchased'] and reserved['changedSinceReservation'], 'Buyer must see changed flag without losing purchased status'
    buyer_view = next(w for w in call('buyer', '/api/members/' + fixtures['ownerId'] + '/wishes')['wishes'] if w['id'] == created['id'])
    third_view = next(w for w in call('other', '/api/members/' + fixtures['ownerId'] + '/wishes')['wishes'] if w['id'] == created['id'])
    assert buyer_view['changedSinceReservation'] is True, 'Reserver sees change warning on current wishlist'
    assert 'changedSinceReservation' not in third_view and 'snapshot' not in third_view, 'Other buyers must not receive private change metadata'
    own = next(w for w in call('owner', '/api/members/' + fixtures['ownerId'] + '/wishes')['wishes'] if w['id'] == created['id'])
    assert own['title'] == 'Rower zamiast książki'
    assert not any(key in own for key in ['snapshot', 'purchased', 'reserved', 'reservedByMe', 'changedSinceReservation']), 'Recipient must not see reservation metadata'
    print('PASS original purchase snapshot, buyer change warning, recipient privacy')
finally:
    call('owner', path, 'DELETE')
