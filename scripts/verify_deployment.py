#!/usr/bin/env python3
"""Verify a real remote deployment: commit, frontend bytes, CSP and anonymous API."""
import argparse
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {'master': 'https://list.do.mikolaja.pl'}
AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'


def fetch(base, path):
    request = urllib.request.Request(base + path, headers={'User-Agent': AGENT, 'Cache-Control': 'no-cache'})
    try:
        response = urllib.request.urlopen(request, timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_raw(base, path):
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(base + path, headers={'User-Agent': AGENT})
    try:
        response = opener.open(request, timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def worker_csp():
    worker = (ROOT / 'src/worker.js').read_text(encoding='utf-8')
    policies = re.findall(r"'Content-Security-Policy': \"([^\"]*)\"", worker)
    assert len(policies) == 1, 'Missing or ambiguous CSP literal'
    return policies[0]


def verify(base, revision, branch):
    if branch == 'master' and 'mikolaja.pl' in base:
        # Stary adres musi przekierowywać na nowy.
        status, headers, _ = fetch_raw('https://mikolaj.walasek.xyz', '/moje?x=1')
        assert status == 301 and headers.get('Location') == base + '/moje?x=1', 'Old domain does not redirect'
    status, headers, body = fetch(base, '/version.json')
    assert status == 200 and json.loads(body) == {'revision': revision, 'branch': branch}, 'Revision has not propagated yet'
    assert 'no-store' in headers.get('Cache-Control', ''), 'Revision endpoint must not be cached'
    for name in sorted(p.name for p in (ROOT / 'public').iterdir() if p.is_file() and p.name != 'index.html'):
        status, _, body = fetch(base, '/' + name)
        assert status == 200 and body == (ROOT / 'public' / name).read_bytes(), 'Source mismatch: ' + name
    status, headers, body = fetch(base, '/')
    assert status == 200, 'Application HTML did not return 200'
    csp = headers.get('Content-Security-Policy', '')
    nonce = re.fullmatch(r".*script-src 'self' 'nonce-([A-Za-z0-9+/]+={0,2})'.*", csp)
    assert nonce, 'Missing CSP nonce'
    assert f"style-src 'self' 'nonce-{nonce[1]}'" in csp, 'Missing CSP style nonce'
    assert csp.replace(f" 'nonce-{nonce[1]}'", '', 2) == worker_csp(), 'CSP was weakened or changed'
    source = (ROOT / 'public/index.html').read_text(encoding='utf-8')
    css = (ROOT / 'public/app.css').read_text(encoding='utf-8')
    tagged = source.replace('<script', f'<script nonce="{nonce[1]}"').replace('<link rel="stylesheet" href="/app.css">', f'<style nonce="{nonce[1]}">{css}</style>')
    # Cloudflare may inject its own nonce'd scripts; everything from the source must be present unchanged.
    html = body.decode('utf-8')
    assert all(line.strip() in html for line in tagged.splitlines()), 'Source mismatch: index.html'
    for path, expected in [('/api/health', 200), ('/api/state', 200), ('/api/admin', 401)]:
        status, _, body = fetch(base, path)
        assert status == expected, 'Unexpected anonymous API status: ' + path
        if path == '/api/health':
            assert json.loads(body).get('storage') == 'sqlite', 'Unhealthy SQLite backend'
        if path == '/api/state':
            assert json.loads(body).get('user') is None, 'Anonymous request is unexpectedly authenticated'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--revision', required=True)
    parser.add_argument('--branch', choices=TARGETS, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.revision):
        parser.error('Revision must be an exact lowercase Git commit SHA')
    base = TARGETS[args.branch]
    for attempt in range(1, 13):
        try:
            verify(base, args.revision, args.branch)
            print(json.dumps({'verified': True, 'url': base, 'revision': args.revision, 'branch': args.branch, 'attempt': attempt}), flush=True)
            return
        except (AssertionError, urllib.error.URLError, TimeoutError, ValueError) as error:
            if attempt == 12:
                raise
            print('Waiting for verified deployment:', error, flush=True)
            time.sleep(5)


if __name__ == '__main__':
    main()
