"""Exact HTML comparison allows only the observed nonce-matching CF scripts."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('verify_deployment', ROOT / 'scripts/verify_deployment.py')
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class HtmlVerification(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / 'public/index.html').read_bytes().decode('utf-8')
        self.nonce = 'YWJjZGVmZ2hpamtsbW5vcA=='
        self.csp = verifier.worker_csp().replace("script-src 'self'", "script-src 'self' 'nonce-" + self.nonce + "'", 1)
        self.html = self.source.replace('<script type="module" src="/app.js"></script>',
                                        '<script type="module" src="/app.js" nonce="' + self.nonce + '"></script>')
        self.beacon = ('<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v' + 'a'*32
                       + '" integrity="sha512-' + 'A'*86 + '==" data-cf-beacon=\'{"token":"fixture"}\''
                       + ' crossorigin="anonymous" nonce="' + self.nonce + '"></script>')
        self.ray = '0123456789abcdef'
        self.timestamp = 'MTc5NDQxMTcyOA=='
        self.jsd_body = (verifier.JSD_TEMPLATE.replace('@NONCE@', self.nonce)
                         .replace('@RAY@', self.ray).replace('@TIMESTAMP@', self.timestamp))
        self.jsd = '<script nonce="' + self.nonce + '">' + self.jsd_body + '</script>'

    def inject(self, script):
        return self.html.replace('</body>', script + '</body>')

    def check(self, html, csp=None):
        verifier.verify_html(html, self.csp if csp is None else csp, self.source)

    def test_accepts_exact_html_with_worker_nonce(self):
        self.check(self.html)

    def test_accepts_recognized_cloudflare_injections(self):
        for script in (self.beacon, self.jsd, self.beacon + self.jsd):
            with self.subTest(script=script):
                self.check(self.inject(script))

    def test_accepts_single_observed_beacon_newline(self):
        self.check(self.inject(self.beacon + '\n' + self.jsd))

    def test_accepts_valid_dynamic_jsd_fields(self):
        nonce = 'cXJzdHV2d3h5ejAxMjM0NQ=='
        script = self.jsd.replace(self.ray, 'fedcba9876543210').replace(self.timestamp, 'MTc5NDQxMTcyOQ==')
        html = self.inject(script).replace(self.nonce, nonce)
        self.check(html, self.csp.replace(self.nonce, nonce))

    def test_rejects_jsd_marker_only_and_appended_payloads(self):
        bodies = [
            "window.__CF$cv$params={};var u='/cdn-cgi/challenge-platform/';",
            "window.__CF$cv$params={r:'" + self.ray + "',t:'" + self.timestamp
            + "'};var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=" + self.ray + "';",
            "/* window.__CF$cv$params /cdn-cgi/challenge-platform/ */alert(1);",
            self.jsd_body + 'alert(1);',
            'alert(1);' + self.jsd_body,
            self.jsd_body + '\n',
        ]
        for body in bodies:
            script = '<script nonce="' + self.nonce + '">' + body + '</script>'
            with self.subTest(body=body), self.assertRaisesRegex(AssertionError, 'index.html'):
                self.check(self.inject(script))

    def test_rejects_jsd_mismatched_repeated_fields(self):
        scripts = [
            self.jsd.replace("d.nonce='" + self.nonce, "d.nonce='wrongNonce"),
            self.jsd.replace("a.nonce='" + self.nonce, "a.nonce='wrongNonce"),
            self.jsd.replace("nonce='" + self.nonce, "nonce='cXJzdHV2d3h5ejAxMjM0NQ=="),
            self.jsd.replace("r:'" + self.ray, "r:'fedcba9876543210"),
            self.jsd.replace('?ray=' + self.ray, '?ray=fedcba9876543210'),
        ]
        for script in scripts:
            with self.subTest(script=script), self.assertRaisesRegex(AssertionError, 'index.html'):
                self.check(self.inject(script))

    def test_rejects_jsd_invalid_dynamic_fields(self):
        scripts = [self.jsd.replace(self.ray, ray) for ray in ('abc', '0123456789abcdeF')]
        scripts += [self.jsd.replace(self.timestamp, timestamp)
                    for timestamp in ('!!!!', 'A', 'YWJj', 'MTc5NDQxMTcyOB==')]
        for script in scripts:
            with self.subTest(script=script), self.assertRaisesRegex(AssertionError, 'index.html'):
                self.check(self.inject(script))

    def test_rejects_stale_visible_html_even_with_both_navigation_tabs(self):
        stale = self.html.replace('Przejdź do treści', 'Stara wersja strony')
        self.assertEqual(stale.count('data-nav="'), 2)
        with self.assertRaisesRegex(AssertionError, 'index.html'):
            self.check(stale)

    def test_rejects_unknown_script_injection(self):
        for script in ('<script src="/unknown.js"></script>',
                       '<script nonce="' + self.nonce + '">window.unexpected=true;</script>'):
            with self.subTest(script=script), self.assertRaisesRegex(AssertionError, 'index.html'):
                self.check(self.inject(script))

    def test_rejects_cloudflare_script_with_wrong_nonce(self):
        for script in (self.beacon, self.jsd):
            with self.subTest(script=script), self.assertRaisesRegex(AssertionError, 'index.html'):
                self.check(self.inject(script.replace(self.nonce, 'wrongNonce')))

    def test_rejects_cloudflare_lookalikes(self):
        scripts = [
            self.beacon.replace('static.cloudflareinsights.com/', 'static.cloudflareinsights.com.evil.example/'),
            self.beacon.replace('sha512-', 'sha256-'),
            self.beacon.replace('{"token":"fixture"}', 'not-json'),
            self.beacon.replace('{"token":"fixture"}', '{}'),
            self.beacon.replace('></script>', '/>'),
            self.beacon.replace('</script>', '</script unexpected>'),
            self.beacon.replace('<script ', '<script nonce="' + self.nonce + '" '),
            self.beacon.replace('></script>', '>unexpected</script>'),
            self.beacon.replace(' type="module"', ' type="module" onload="unexpected()"'),
            self.jsd.replace('<script ', '<script data-unexpected="true" '),
            self.jsd.replace('window.__CF$cv$params', 'window.unrecognized'),
            self.jsd.replace('/cdn-cgi/challenge-platform/', '/unrecognized/'),
        ]
        for script in scripts:
            with self.subTest(script=script), self.assertRaisesRegex(AssertionError, 'index.html'):
                self.check(self.inject(script))

    def test_rejects_duplicate_recognized_injections(self):
        for script in (self.beacon, self.jsd):
            with self.subTest(script=script), self.assertRaisesRegex(AssertionError, 'Duplicate'):
                self.check(self.inject(script + script))

    def test_preserves_whitespace_comments_and_other_markup(self):
        for html in (self.html.replace('<body>', '<body> '),
                     self.html.replace('</body>', '<!-- unexpected -->\n</body>'),
                     self.inject(self.beacon + '\n\n'),
                     self.html.replace('class="skip-link"', 'class="changed"')):
            with self.subTest(html=html), self.assertRaisesRegex(AssertionError, 'index.html'):
                self.check(html)

    def test_rejects_missing_or_wrong_app_nonce(self):
        for html in (self.source, self.html.replace(self.nonce, 'wrongNonce')):
            with self.subTest(html=html), self.assertRaisesRegex(AssertionError, 'index.html'):
                self.check(html)

    def test_rejects_missing_or_ambiguous_csp_nonce(self):
        for csp in ("script-src 'self'", self.csp + " 'nonce-second'"):
            with self.subTest(csp=csp), self.assertRaisesRegex(AssertionError, 'CSP nonce'):
                self.check(self.html, csp)

    def test_rejects_weakened_csp(self):
        for csp in (self.csp + " 'unsafe-inline'",
                    self.csp.replace("'nonce-" + self.nonce + "'", "'nonce-" + self.nonce + "' 'unsafe-eval'"),
                    self.csp.replace("frame-ancestors 'none'; ", '')):
            with self.subTest(csp=csp), self.assertRaisesRegex(AssertionError, 'weakened'):
                self.check(self.html, csp)


if __name__ == '__main__':
    unittest.main()
