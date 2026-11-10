#!/usr/bin/env python3
"""Upload source modules directly to Cloudflare; no local builds/install.

Requires CLOUDFLARE_API_TOKEN. Creates only this application's Worker,
SQLite Durable Object namespace and exact requested hostname.
Never logs secrets. SETUP_TOKEN is generated once per Worker and retained.
Usage: python scripts/deploy.py --account ACCOUNT --zone ZONE [--preview]
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://api.cloudflare.com/client/v4'


def api(path, method='GET', data=None, raw=None, content_type=None):
    headers = {'Authorization': 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN']}
    if data is not None:
        raw = json.dumps(data).encode()
        content_type = 'application/json'
    if content_type:
        headers['Content-Type'] = content_type
    request = urllib.request.Request(BASE + path, data=raw, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        # Cloudflare errors do not include request authorization or secret values.
        value = json.loads(error.read())
        raise RuntimeError(f'Cloudflare HTTP {error.code}: {value.get("errors", [])}') from None
    if not result.get('success'):
        raise RuntimeError(f'Cloudflare: {result.get("errors", [])}')
    return result.get('result')


def multipart(parts):
    boundary = 'mikolaj-' + secrets.token_hex(24)
    chunks = []
    for name, mime, content in parts:
        chunks += [f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{name}"\r\nContent-Type: {mime}\r\n\r\n'.encode(), content, b'\r\n']
    chunks.append(f'--{boundary}--\r\n'.encode())
    return b''.join(chunks), 'multipart/form-data; boundary=' + boundary


def persist_bootstrap(name, rotate=False):
    """Persist BEFORE upload; retries reuse a durable, owner-only secret."""
    directory = Path(os.environ.get('MIKOLAJ_BOOTSTRAP_DIR', str(Path.home() / '.local/share/mikolaj/bootstrap')))
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    private = directory / f'{name}-setup.json'
    if rotate:
        # Keep old secret available for rollback; never overwrite it silently.
        private = directory / f'{name}-setup-{secrets.token_hex(8)}.json'
    if private.exists():
        saved = json.loads(private.read_text())
        token = saved.get('setupToken', '')
        if saved.get('worker') != name or len(token) != 64 or any(char not in '0123456789abcdef' for char in token):
            raise RuntimeError('Invalid local bootstrap file; refusing to upload')
        return token, private
    token = secrets.token_hex(32)
    descriptor = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        json.dump({'setupToken': token, 'worker': name}, handle)
        handle.flush()
        os.fsync(handle.fileno())
    # Persist the directory entry as well as the file contents.
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return token, private


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--account', required=True)
    parser.add_argument('--zone', required=True)
    parser.add_argument('--preview', action='store_true')
    parser.add_argument('--rotate-setup-token', action='store_true', help='Explicit bootstrap recovery; invalidates the old setup link, not accounts or data')
    args = parser.parse_args()
    name = 'mikolaj-preview' if args.preview else 'mikolaj'
    hostname = 'mikolaj.walasek.xyz'
    prefix = f'/accounts/{args.account}/workers'
    verified = api('/user/tokens/verify')
    if verified['status'] != 'active':
        raise RuntimeError('Cloudflare token is not active')
    zone = api(f'/zones/{args.zone}')
    if zone['name'] != 'walasek.xyz' or zone['account']['id'] != args.account:
        raise RuntimeError('Wrong Cloudflare account or zone')
    scripts = api(prefix + '/scripts')
    exists = any(script['id'] == name for script in scripts)
    setup = None
    bindings = [{'type': 'durable_object_namespace', 'name': 'FAMILY', 'class_name': 'FamilyStore'}]
    if args.preview:
        bindings.append({'type': 'plain_text', 'name': 'STORE_NAME', 'text': 'family-ui-test-v1'})
    if exists and not args.rotate_setup_token:
        bindings.append({'type': 'inherit', 'name': 'SETUP_TOKEN'})
        settings = api(prefix + f'/scripts/{name}/settings')
        if not any(binding['name'] == 'SETUP_TOKEN' for binding in settings.get('bindings', [])):
            raise RuntimeError('Existing Worker has no SETUP_TOKEN; use explicit --rotate-setup-token recovery')
    else:
        setup, private = persist_bootstrap(name, rotate=args.rotate_setup_token)
        bindings.append({'type': 'secret_text', 'name': 'SETUP_TOKEN', 'text': setup})
    metadata = {'main_module': 'src/worker.js', 'compatibility_date': '2026-11-10', 'bindings': bindings, 'logpush': False}
    if not exists:
        metadata['migrations'] = {'new_tag': 'v1', 'steps': [{'new_sqlite_classes': ['FamilyStore']}]}
    parts = [('metadata', 'application/json', json.dumps(metadata).encode()), ('src/worker.js', 'application/javascript+module', (ROOT / 'src/worker.js').read_bytes())]
    for file in ['index.html', 'app.css', 'app.js', 'favicon.svg']:
        parts.append(('public/' + file, 'text/plain', (ROOT / 'public' / file).read_bytes()))
    payload, content_type = multipart(parts)
    deployed = api(prefix + f'/scripts/{name}', 'PUT', raw=payload, content_type=content_type)
    settings = api(prefix + f'/scripts/{name}/settings')
    if not any(binding['name'] == 'FAMILY' for binding in settings.get('bindings', [])):
        raise RuntimeError('Read-back failed: missing FAMILY binding')
    if setup:
        print('Private bootstrap persisted before upload:', private)
    if args.preview:
        api(prefix + f'/scripts/{name}/subdomain', 'POST', {'enabled': True, 'previews_enabled': False})
        subdomain = api(prefix + '/subdomain')['subdomain']
        print('PREVIEW_URL=https://' + name + '.' + subdomain + '.workers.dev')
    else:
        # Read exact resources before writing. Never overwrite unrelated records.
        records = api(f'/zones/{args.zone}/dns_records?name={hostname}')
        domains = api(prefix + '/domains')
        matching = [domain for domain in domains if domain['hostname'] == hostname]
        if matching and matching[0]['service'] != name:
            raise RuntimeError('Hostname already belongs to another Worker')
        if records and not matching:
            raise RuntimeError('Hostname has existing DNS records; refusing to replace them')
        domain = api(prefix + '/domains', 'PUT', {'hostname': hostname, 'service': name, 'zone_id': args.zone, 'enabled': True, 'previews_enabled': False})
        final = api(prefix + '/domains/' + domain['id'])
        if final['hostname'] != hostname or final['service'] != name or not final['enabled']:
            raise RuntimeError('Read-back failed: wrong domain configuration')
        print('DEPLOYED_URL=https://' + hostname)
    print('Worker upload verified:', name, deployed.get('id'))


if __name__ == '__main__':
    main()
