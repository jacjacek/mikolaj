#!/usr/bin/env python3
"""Verify a real remote deployment, including commit and exact frontend bytes."""
import argparse
import base64
import binascii
from html.parser import HTMLParser
from pathlib import Path
import re
import time
import json
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {'master': 'https://mikolaj.walasek.xyz', 'develop': 'https://mikolaj-preview.jac3k.workers.dev'}
AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

# The complete observed bootstrap, not a marker-based JavaScript allowlist.
# Only these three placeholders may vary; repeated placeholders must agree.
JSD_TEMPLATE = (
    "(function(){function c(){var b=a.contentDocument||(a.contentWindow&&a.contentWindow.document);"
    "if(b){var d=b.createElement('script');d.nonce='@NONCE@';"
    'd.innerHTML="window.__CF$cv$params={r:\'@RAY@\',t:\'@TIMESTAMP@\'};'
    "var l=window.parent.location,o;try{o=new URL(l.origin).origin}catch(e){"
    "try{o=new URL(new URL(l.href).origin).origin}catch(e){o=''}}"
    "var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=@RAY@',"
    "a=document.createElement('script');a.nonce='@NONCE@';a.src=o?new URL(u,o).href:u;"
    'document.getElementsByTagName(\'head\')[0].appendChild(a);";'
    "b.getElementsByTagName('head')[0].appendChild(d)}}if(document.body){"
    "var a=document.createElement('iframe');a.height=1;a.width=1;a.style.position='absolute';"
    "a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';"
    "document.body.appendChild(a);if('loading'!==document.readyState)c();"
    "else if(window.addEventListener)document.addEventListener('DOMContentLoaded',c);"
    "else{var e=document.onreadystatechange||function(){};document.onreadystatechange=function(b){"
    "e(b);'loading'!==document.readyState&&(document.onreadystatechange=e,c())}}}})();"
)


def recognized_jsd(body, nonce):
    fields = re.search(r"window\.__CF\$cv\$params=\{r:'([0-9a-f]{16})',t:'([A-Za-z0-9+/]+={0,2})'\};", body)
    if fields is None:
        return False
    ray, timestamp = fields.groups()
    try:
        decoded = base64.b64decode(timestamp, validate=True)
    except (ValueError, binascii.Error):
        return False
    if not re.fullmatch(rb'[0-9]+', decoded) or base64.b64encode(decoded).decode('ascii') != timestamp:
        return False
    expected = JSD_TEMPLATE.replace('@NONCE@', nonce).replace('@RAY@', ray).replace('@TIMESTAMP@', timestamp)
    return body == expected


def worker_csp():
    worker = (ROOT / 'src/worker.js').read_text(encoding='utf-8')
    security = re.search(r'^const SECURITY = \{\n(.*?)^\};', worker, re.MULTILINE | re.DOTALL)
    assert security is not None, 'Missing checked-out SECURITY policy'
    policies = re.findall(r'^  \'Content-Security-Policy\': "([^"\\\r\n]*)",$', security[1], re.MULTILINE)
    assert len(policies) == 1, 'Missing or ambiguous checked-out CSP literal'
    return policies[0]


def fetch(base, path):
    request = urllib.request.Request(base + path, headers={'User-Agent': AGENT, 'Cache-Control': 'no-cache'})
    try:
        response = urllib.request.urlopen(request, timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


class CloudflareScripts(HTMLParser):
    """Locate only recognized injected scripts; never reserialize the HTML."""

    def __init__(self, html, nonce):
        super().__init__(convert_charrefs=False)
        self.html = html
        self.nonce = nonce
        self.lines = [0]
        for match in re.finditer('\n', html):
            self.lines.append(match.end())
        self.pending = None
        self.removals = []
        self.beacon_newline = None
        self.seen = set()

    def source_offset(self):
        line, column = self.getpos()
        return self.lines[line - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.pending = (self.source_offset(), self.source_offset() + len(self.get_starttag_text()), attrs)

    def handle_endtag(self, tag):
        if tag != 'script' or self.pending is None:
            return
        start, body_start, pairs = self.pending
        self.pending = None
        attrs = dict(pairs)
        if len(attrs) != len(pairs) or attrs.get('nonce') != self.nonce:
            return
        body = self.html[body_start:self.source_offset()]
        end = self.source_offset() + len('</script>')
        if self.html[self.source_offset():end] != '</script>':
            return
        kind = None
        if set(attrs) == {'nonce'} and recognized_jsd(body, self.nonce):
            kind = 'jsd'
        elif (set(attrs) == {'nonce', 'type', 'src', 'integrity', 'data-cf-beacon', 'crossorigin'}
              and attrs['type'] == 'module' and attrs['crossorigin'] == 'anonymous' and body == ''
              and re.fullmatch(r'https://static\.cloudflareinsights\.com/beacon\.min\.js/v?[a-f0-9]+', attrs['src'] or '')
              and re.fullmatch(r'sha512-[A-Za-z0-9+/]{86}==', attrs['integrity'] or '')):
            try:
                beacon = json.loads(attrs['data-cf-beacon'])
            except (ValueError, TypeError):
                return
            if isinstance(beacon, dict) and isinstance(beacon.get('token'), str) and beacon['token']:
                kind = 'beacon'
        if kind is None:
            return
        assert kind not in self.seen, 'Duplicate Cloudflare injection'
        self.seen.add(kind)
        self.removals.append((start, end))
        if kind == 'beacon' and self.html[end:end + 1] == '\n':
            self.beacon_newline = (end, end + 1)


def verify_html(html, csp, source):
    nonces = re.findall(r"'nonce-([A-Za-z0-9+/]+={0,2})'", csp)
    assert len(nonces) == 1, 'Missing or ambiguous CSP nonce'
    nonce = nonces[0]
    policy_without_nonce = csp.replace("script-src 'self' 'nonce-" + nonce + "'", "script-src 'self'", 1)
    assert policy_without_nonce == worker_csp(), 'CSP was weakened or changed'
    app_script = '<script type="module" src="/app.js"></script>'
    assert source.count(app_script) == 1, 'Unexpected checked-out app script'
    expected = source.replace(app_script, '<script type="module" src="/app.js" nonce="' + nonce + '"></script>', 1)
    parser = CloudflareScripts(html, nonce)
    parser.feed(html)
    parser.close()
    def remove_spans(spans):
        result = html
        for start, end in sorted(spans, reverse=True):
            result = result[:start] + result[end:]
        return result
    # Preserve every byte except recognized tags and the single optional LF
    # Cloudflare adds immediately after its beacon. No general whitespace folding.
    actual = remove_spans(parser.removals)
    if actual != expected and parser.beacon_newline is not None:
        actual = remove_spans(parser.removals + [parser.beacon_newline])
    assert actual == expected, 'Source mismatch: index.html'


def verify(base, revision, branch):
    status, headers, body = fetch(base, '/version.json')
    assert status == 200, 'Version endpoint did not return 200'
    assert json.loads(body) == {'revision': revision, 'branch': branch}, 'Revision has not propagated yet'
    assert 'no-store' in headers.get('Cache-Control', ''), 'Revision endpoint must not be cached'
    for name in ['app.css', 'app.js', 'demo.js', 'favicon.svg']:
        status, _, body = fetch(base, '/' + name)
        assert status == 200 and body == (ROOT / 'public' / name).read_bytes(), 'Source mismatch: ' + name
    status, headers, body = fetch(base, '/')
    assert status == 200, 'Application HTML did not return 200'
    verify_html(body.decode('utf-8'), headers.get('Content-Security-Policy', ''), (ROOT / 'public/index.html').read_bytes().decode('utf-8'))
    for path, expected in [('/api/health', 200), ('/api/me', 200), ('/api/reservations', 401)]:
        status, _, body = fetch(base, path)
        assert status == expected, 'Unexpected anonymous API status: ' + path
        if path == '/api/health':
            health = json.loads(body)
            assert health.get('ok') is True and health.get('storage') == 'sqlite', 'Unhealthy SQLite backend'
        elif path == '/api/me':
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
            print('Waiting for verified deployment:', type(error).__name__, flush=True)
            time.sleep(5)


if __name__ == '__main__':
    main()
