"""Mocked GitHub branch-head checks; no remote calls or credentials required."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import mock_open, patch
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('branch_head_guard', ROOT / 'scripts/branch_head_guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class BranchHeadGuard(unittest.TestCase):
    repository = 'example/mikolaj'
    ref = 'refs/heads/master'
    revision = 'a'*40
    token = 'fixture-ephemeral-token'

    def payload(self, sha=None):
        return {'ref': self.ref, 'object': {'type': 'commit', 'sha': sha or self.revision}}

    def invoke(self, payload=None, error=None, status=200, raw=None):
        response = io.BytesIO(raw if raw is not None else json.dumps(self.payload() if payload is None else payload).encode())
        response.status = status
        output = mock_open()
        stdout = io.StringIO()
        argv = ['branch_head_guard.py', '--repository', self.repository, '--ref', self.ref, '--revision', self.revision]
        exit_code = None
        with patch.object(sys, 'argv', argv), patch.dict(os.environ, {'GITHUB_TOKEN': self.token, 'GITHUB_OUTPUT': 'mock-output'}), \
                patch.object(guard.Path, 'open', output), patch.object(guard.urllib.request, 'build_opener') as factory, \
                contextlib.redirect_stdout(stdout):
            factory.return_value.open.return_value.__enter__.return_value = response
            factory.return_value.open.side_effect = error
            try:
                guard.main()
            except SystemExit as caught:
                exit_code = caught.code
        flags = ''.join(call.args[0] for call in output().write.call_args_list)
        self.assertNotIn(self.token, stdout.getvalue())
        self.assertNotIn(self.token, str(exit_code))
        return exit_code, flags, stdout.getvalue(), factory

    def test_matching_head_emits_deploy_true(self):
        code, flags, text, factory = self.invoke()
        self.assertIsNone(code)
        self.assertEqual(flags, 'deploy=true\n')
        self.assertIn('permitted', text)
        request = factory.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://api.github.com/repos/example/mikolaj/git/ref/heads/master')
        self.assertEqual(request.get_header('Authorization'), 'Bearer ' + self.token)
        self.assertEqual(request.get_method(), 'GET')
        self.assertIsInstance(factory.call_args.args[0], guard.NoRedirect)

    def test_old_sha_emits_deploy_false(self):
        code, flags, text, _ = self.invoke(self.payload('b'*40))
        self.assertIsNone(code)
        self.assertEqual(flags, 'deploy=false\n')
        self.assertIn('Superseded', text)
        self.assertIn('skipped', text)

    def test_api_errors_fail_closed(self):
        for error in (urllib.error.HTTPError('https://api.github.com/', 403, self.token, {}, None),
                      urllib.error.URLError(self.token), TimeoutError(self.token),
                      RuntimeError(self.token), guard.HTTPException(self.token)):
            with self.subTest(error=type(error).__name__):
                code, flags, _, _ = self.invoke(error=error)
                self.assertIsNotNone(code)
                self.assertEqual(flags, 'deploy=false\n')

    def test_unexpected_http_status_fails_closed(self):
        code, flags, _, _ = self.invoke(status=503)
        self.assertIsNotNone(code)
        self.assertEqual(flags, 'deploy=false\n')

    def test_invalid_json_fails_closed(self):
        code, flags, _, _ = self.invoke(raw=self.token.encode())
        self.assertIsNotNone(code)
        self.assertEqual(flags, 'deploy=false\n')

    def test_wrong_or_malformed_remote_ref_fails_closed(self):
        for payload in ([], {}, {'ref': 'refs/heads/develop', 'object': {'type': 'commit', 'sha': self.revision}},
                        {'ref': self.ref, 'object': {'type': 'tag', 'sha': self.revision}},
                        {'ref': self.ref, 'object': {'type': 'commit', 'sha': 'A'*40}},
                        {'ref': self.ref, 'object': {'type': 'commit', 'sha': 123}}):
            with self.subTest(payload=payload):
                code, flags, _, _ = self.invoke(payload=payload)
                self.assertIsNotNone(code)
                self.assertEqual(flags, 'deploy=false\n')

    def test_develop_uses_exact_branch_ref(self):
        with patch.object(self, 'ref', 'refs/heads/develop'):
            code, flags, _, factory = self.invoke()
        self.assertIsNone(code)
        self.assertEqual(flags, 'deploy=true\n')
        self.assertTrue(factory.return_value.open.call_args.args[0].full_url.endswith('/git/ref/heads/develop'))

    def test_invalid_inputs_are_rejected_before_network(self):
        cases = [
            ('https://evil.example/repo', self.ref, self.revision),
            ('example/repo?redirect=evil', self.ref, self.revision),
            ('example/..', self.ref, self.revision),
            ('example/repo/extra', self.ref, self.revision),
            (self.repository, 'refs/tags/master', self.revision),
            (self.repository, 'refs/heads/master/../develop', self.revision),
            (self.repository, 'master', self.revision),
            (self.repository, self.ref, 'A'*40),
        ]
        for repository, ref, revision in cases:
            with self.subTest(repository=repository, ref=ref), patch.object(guard.urllib.request, 'build_opener') as factory:
                with self.assertRaises(ValueError):
                    guard.should_deploy(repository, ref, revision, self.token)
                factory.assert_not_called()

    def test_missing_token_is_rejected_before_network(self):
        with patch.object(guard.urllib.request, 'build_opener') as factory:
            with self.assertRaises(RuntimeError):
                guard.should_deploy(self.repository, self.ref, self.revision, '')
            factory.assert_not_called()

    def test_redirects_are_never_followed(self):
        request = urllib.request.Request('https://api.github.com/', headers={'Authorization': 'Bearer ' + self.token})
        with self.assertRaisesRegex(RuntimeError, 'refused a redirect'):
            guard.NoRedirect().redirect_request(request, None, 302, 'Found', {}, 'https://evil.example/')


if __name__ == '__main__':
    unittest.main()
