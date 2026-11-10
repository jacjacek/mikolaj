#!/usr/bin/env python3
"""Integration checks against an isolated deployed preview Worker only.

No local server or dependency install. Never run against production:
this test creates a disposable family and three test accounts.
"""
import concurrent.futures
import http.cookiejar
import json
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = sys.argv[1].rstrip('/')
if not BASE.startswith('https://mikolaj-preview.') or not BASE.endswith('.workers.dev'):
    raise SystemExit('Tests are restricted to the isolated preview Worker.')
setup = json.loads(Path(sys.argv[2]).read_text())['setupToken']
checks = []


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print('PASS', label)


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, path, method='GET', data=None, origin=None):
        headers = {'Origin': origin or BASE, 'User-Agent': 'Mikolaj-Integration-Test/1.0'}
        payload = None
        if method != 'GET' and method != 'DELETE':
            headers['Content-Type'] = 'application/json'
            payload = json.dumps(data or {}).encode()
        request = urllib.request.Request(BASE + path, headers=headers, data=payload, method=method)
        try:
            with self.opener.open(request, timeout=45) as response:
                return response.status, json.load(response), dict(response.headers)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error), dict(error.headers)


anonymous, owner, buyer, other = Client(), Client(), Client(), Client()
check(anonymous.call('/api/me')[1] == {'user': None}, 'anonymous has no family data')
check(anonymous.call('/api/reservations')[0] == 401, 'anonymous cannot read reservations')
check(anonymous.call('/api/invite')[0] == 401, 'anonymous cannot read invitation')
password = secrets.token_urlsafe(24)
email = 'owner-' + secrets.token_hex(5) + '@example.invalid'
status, data, headers = owner.call('/api/create', 'POST', {'setupToken': setup, 'familyName': 'Testy Mikołaja', 'name': 'Alicja Test', 'email': email, 'password': password})
check(status == 200 and data['user']['isAdmin'], 'private setup creates the administrator')
check(all(value in headers.get('Set-Cookie', '') for value in ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']), 'session cookie has security flags')
owner_id = data['user']['id']
check(anonymous.call('/api/create', 'POST', {'setupToken': 'bad', 'familyName': 'x', 'name': 'x', 'email': 'x@example.invalid', 'password': password})[0] == 403, 'invalid bootstrap cannot create family')
invite = owner.call('/api/invite')[1]['url'].split('#invite=')[1]
check(anonymous.call('/api/invitation/' + invite)[1]['familyName'] == 'Testy Mikołaja', 'valid invitation exposes only family name')
check(anonymous.call('/api/invitation/' + 'a' * 64)[0] == 404, 'invalid invitation rejected')
ids = []
for client, name in [(buyer, 'Bartek Test'), (other, 'Celina Test')]:
    status, joined, _ = client.call('/api/join', 'POST', {'inviteToken': invite, 'name': name, 'email': secrets.token_hex(6) + '@example.invalid', 'password': password})
    check(status == 200 and not joined['user']['isAdmin'], name + ' joins as regular member')
    ids.append(joined['user']['id'])
check(len(owner.call('/api/me')[1]['members']) == 3, 'family member count persists')
check(buyer.call('/api/invite')[0] == 403, 'regular members cannot read invitation')
check(other.call('/api/invite', 'POST')[0] == 403, 'regular members cannot rotate invitation')
letter = 'Drogi Mikołaju, marzę o spokojnych świętach. 🎄'
check(owner.call('/api/letter', 'PATCH', {'letter': letter})[0] == 200, 'Polish letter saves')
check(buyer.call('/api/members/' + owner_id + '/wishes')[1]['member']['letter'] == letter, 'letter visible to family')
wish = {'title': 'Książka „Święta”', 'note': '<script>alert(1)</script> — wydanie papierowe', 'url': 'https://example.com/book?x=1&y=2', 'price': 99.99}
status, created, _ = owner.call('/api/wishes', 'POST', wish)
check(status == 201, 'wishlist item created')
wid = created['id']
path = '/api/wishes/' + wid
before = owner.call('/api/members/' + owner_id + '/wishes')[1]
check(before['wishes'][0]['title'] == wish['title'] and before['wishes'][0]['price'] == 99.99, 'wishlist content and price persist')
check(buyer.call(path, 'PATCH', wish)[0] == 403, 'other member cannot edit wish')
check(buyer.call(path, 'DELETE')[0] == 403, 'other member cannot delete wish')
check(owner.call(path + '/reserve', 'POST')[0] == 403, 'self-reservation rejected')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    outcomes = list(pool.map(lambda client: client.call(path + '/reserve', 'POST'), [buyer, other]))
check(sorted(result[0] for result in outcomes) == [200, 409], 'concurrent reservations have exactly one winner')
winner = buyer if outcomes[0][0] == 200 else other
loser = other if winner is buyer else buyer
check(owner.call('/api/members/' + owner_id + '/wishes')[1] == before, 'recipient JSON unchanged after reservation: no leaked metadata')
visible = loser.call('/api/members/' + owner_id + '/wishes')[1]['wishes'][0]
check(visible['reserved'] and not visible['reservedByMe'] and 'buyer' not in visible, 'other buyers see reserved state without buyer identity')
check(loser.call(path + '/reserve', 'DELETE')[0] == 403, 'non-reserver cannot cancel')
check(loser.call(path + '/reserve', 'PATCH', {'purchased': True})[0] == 403, 'non-reserver cannot mark bought')
check(winner.call(path + '/reserve', 'PATCH', {'purchased': True})[0] == 200, 'reserver marks gift bought')
reserved = winner.call('/api/reservations')[1]['wishes']
check(len(reserved) == 1 and reserved[0]['purchased'] and reserved[0]['ownerName'] == 'Alicja Test', 'shopping list persists bought status')
check(owner.call('/api/members/' + owner_id + '/wishes')[1] == before, 'recipient JSON unchanged after purchase')
check(winner.call(path + '/reserve', 'DELETE')[0] == 200, 'reserver cancels reservation')
check(not loser.call('/api/members/' + owner_id + '/wishes')[1]['wishes'][0]['reserved'], 'cancelled gift becomes available again')
check(loser.call(path + '/reserve', 'POST')[0] == 200, 'released gift can be reserved by someone else')
for bad in ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@example.com']:
    check(owner.call('/api/wishes', 'POST', {**wish, 'url': bad})[0] == 400, 'unsafe URL rejected: ' + bad.split(':')[0])
check(owner.call('/api/wishes', 'POST', {**wish, 'price': -1})[0] == 400, 'negative price rejected')
check(owner.call('/api/letter', 'PATCH', {'letter': 'a' * 4001})[0] == 400, 'oversized letter rejected')
check(owner.call('/api/letter', 'PATCH', {'letter': 'not saved'}, origin='https://evil.invalid')[0] == 403, 'cross-origin write rejected')
check(owner.call('/api/members/' + ids[0] + '/wishes')[0] == 200, 'real member list reachable')
check(owner.call('/api/members/not-a-member/wishes')[0] == 404, 'nonexistent member list rejected')
check(owner.call(path, 'DELETE')[0] == 200, 'owner can delete reserved wish without leaking reservation status')
check(loser.call('/api/reservations')[1]['wishes'] == [], 'deleted wish removes reservation')
new_invite = owner.call('/api/invite', 'POST')[1]['url'].split('#invite=')[1]
check(new_invite != invite and anonymous.call('/api/invitation/' + invite)[0] == 404, 'invitation rotation invalidates old link')
check(owner.call('/api/invite')[1]['url'].endswith(new_invite), 'new invitation read back')
check(owner.call('/api/logout', 'POST')[0] == 200 and owner.call('/api/me')[1] == {'user': None}, 'logout invalidates session')
check(owner.call('/api/login', 'POST', {'email': email, 'password': 'wrong-password'})[0] == 401, 'wrong password rejected')
check(owner.call('/api/login', 'POST', {'email': email, 'password': password})[0] == 200, 'account works on subsequent login')
check(owner.call('/api/me')[1]['members'][0]['letter'] == letter, 'letter survives logout and login')
# Retain generated preview-only sessions for authenticated browser checks.
# Never include these credentials in source control, logs or production.
import os
fixture_path = Path(sys.argv[2]).with_name('mikolaj-preview-fixtures.json')
fixtures = {'base': BASE, 'ownerId': owner_id, 'invite': new_invite, 'accounts': {}}
for label, client in [('owner', owner), ('buyer', buyer), ('other', other)]:
    fixtures['accounts'][label] = {'cookies': [{'name': item.name, 'value': item.value} for item in client.jar], 'me': client.call('/api/me')[1]}
fd = os.open(fixture_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as handle:
    json.dump(fixtures, handle)
print(json.dumps({'passed': len(checks), 'base': BASE, 'checks': checks}, ensure_ascii=False, indent=2))
