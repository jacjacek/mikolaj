"""Unit fixtures for deployment safeguards; real deployment verification is separate."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('deploy', ROOT/'scripts/deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentSafety(unittest.TestCase):
    def setUp(self):
        self.uploaded = None
        self.writes = []
        self.exists = True
        self.wrong_domain = False
        self.changed_namespace = False
        self.preview = False
        self.before_bindings = {}
        self.after_bindings = {}

    def api(self, path, method='GET', data=None, raw=None, content_type=None):
        if method != 'GET':
            self.writes.append((method, path))
        if path == '/user/tokens/verify': return {'status': 'active'}
        if path == '/zones/zone': return {'name': 'walasek.xyz', 'account': {'id': 'account'}}
        if path.endswith('/scripts'):
            return [{'id': 'mikolaj'}, {'id': 'mikolaj-preview'}] if self.exists else []
        if path.endswith('/domains'):
            return [{'hostname': 'mikolaj.walasek.xyz', 'service': 'other' if self.wrong_domain else 'mikolaj', 'zone_id': 'zone'}]
        if path.endswith('/settings'):
            family = {'name': 'FAMILY', 'type': 'durable_object_namespace', 'class_name': 'FamilyStore', 'namespace_id': 'changed' if self.uploaded and self.changed_namespace else 'stable'}
            bindings = [family, {'name': 'SETUP_TOKEN', 'type': 'secret_text'}]
            if self.uploaded:
                bindings += [
                    {'name': 'DEPLOY_REVISION', 'type': 'plain_text', 'text': 'a'*40},
                    {'name': 'DEPLOY_BRANCH', 'type': 'plain_text', 'text': 'develop' if self.preview else 'master'},
                ]
            overrides = self.after_bindings if self.uploaded else self.before_bindings
            return {'bindings': [overrides.get(binding['name'], binding) for binding in bindings if overrides.get(binding['name'], binding) is not None]}
        if method == 'PUT' and '/scripts/mikolaj' in path:
            self.uploaded = json.loads(raw.split(b'\r\n\r\n', 1)[1].split(b'\r\n--', 1)[0])
            return {'id': 'mikolaj-preview' if self.preview else 'mikolaj'}
        if path.endswith('/subdomain') and method == 'GET': return {'subdomain': 'example'}
        raise AssertionError('Unexpected API operation: ' + method + ' ' + path)

    def run_deploy(self, extra=(), revision=True):
        args = ['deploy.py', '--account', 'account', '--zone', 'zone', '--ci', '--branch', 'develop' if self.preview else 'master']
        if revision: args += ['--revision', 'a'*40]
        if self.preview: args += ['--preview']
        args += list(extra)
        with patch.object(sys, 'argv', args), patch.object(deploy, 'api', self.api), patch.object(deploy, 'persist_bootstrap') as bootstrap, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                deploy.main()
            finally:
                bootstrap.assert_not_called()

    def test_production_preserves_store_secret_and_routes(self):
        self.run_deploy()
        self.assertEqual(self.uploaded['main_module'], 'src/worker.js')
        self.assertNotIn('migrations', self.uploaded)
        self.assertIn({'type': 'inherit', 'name': 'SETUP_TOKEN'}, self.uploaded['bindings'])
        self.assertIn({'type': 'plain_text', 'name': 'DEPLOY_REVISION', 'text': 'a'*40}, self.uploaded['bindings'])
        self.assertEqual(self.writes, [('PUT', '/accounts/account/workers/scripts/mikolaj')])

    def test_preview_has_separate_object_key_and_no_route_mutation(self):
        self.preview = True
        self.run_deploy()
        self.assertIn({'type': 'plain_text', 'name': 'STORE_NAME', 'text': 'family-ui-test-v1'}, self.uploaded['bindings'])
        self.assertEqual(self.writes, [('PUT', '/accounts/account/workers/scripts/mikolaj-preview')])

    def test_missing_worker_never_creates_namespace_or_bootstrap(self):
        self.exists = False
        with self.assertRaisesRegex(RuntimeError, 'missing Worker'):
            self.run_deploy()
        self.assertEqual(self.writes, [])

    def test_wrong_domain_refuses_upload(self):
        self.wrong_domain = True
        with self.assertRaisesRegex(RuntimeError, 'domain attachment'):
            self.run_deploy()
        self.assertEqual(self.writes, [])

    def test_namespace_change_fails_readback(self):
        self.changed_namespace = True
        with self.assertRaisesRegex(RuntimeError, 'namespace changed'):
            self.run_deploy()

    def test_missing_family_refuses_upload(self):
        self.before_bindings['FAMILY'] = None
        with self.assertRaisesRegex(RuntimeError, 'unexpected FAMILY'):
            self.run_deploy()
        self.assertEqual(self.writes, [])

    def test_missing_setup_token_refuses_upload(self):
        self.before_bindings['SETUP_TOKEN'] = None
        with self.assertRaisesRegex(RuntimeError, 'no SETUP_TOKEN'):
            self.run_deploy()
        self.assertEqual(self.writes, [])

    def test_wrong_setup_token_type_refuses_upload(self):
        self.before_bindings['SETUP_TOKEN'] = {'name': 'SETUP_TOKEN', 'type': 'plain_text'}
        with self.assertRaisesRegex(RuntimeError, 'unexpected SETUP_TOKEN'):
            self.run_deploy()
        self.assertEqual(self.writes, [])

    def test_missing_family_fails_readback(self):
        self.after_bindings['FAMILY'] = None
        with self.assertRaisesRegex(RuntimeError, 'missing FAMILY'):
            self.run_deploy()

    def test_wrong_family_type_fails_readback(self):
        self.after_bindings['FAMILY'] = {'name': 'FAMILY', 'type': 'plain_text', 'class_name': 'FamilyStore', 'namespace_id': 'stable'}
        with self.assertRaisesRegex(RuntimeError, 'incorrect FAMILY'):
            self.run_deploy()

    def test_missing_setup_token_fails_readback(self):
        self.after_bindings['SETUP_TOKEN'] = None
        with self.assertRaisesRegex(RuntimeError, 'incorrect SETUP_TOKEN'):
            self.run_deploy()

    def test_wrong_setup_token_type_fails_readback(self):
        self.after_bindings['SETUP_TOKEN'] = {'name': 'SETUP_TOKEN', 'type': 'inherit'}
        with self.assertRaisesRegex(RuntimeError, 'incorrect SETUP_TOKEN'):
            self.run_deploy()

    def test_incorrect_revision_fails_readback(self):
        self.after_bindings['DEPLOY_REVISION'] = {'name': 'DEPLOY_REVISION', 'type': 'plain_text', 'text': 'b'*40}
        with self.assertRaisesRegex(RuntimeError, 'incorrect deployment revision'):
            self.run_deploy()

    def test_missing_revision_fails_readback(self):
        self.after_bindings['DEPLOY_REVISION'] = None
        with self.assertRaisesRegex(RuntimeError, 'incorrect deployment revision'):
            self.run_deploy()

    def test_incorrect_branch_fails_readback(self):
        self.after_bindings['DEPLOY_BRANCH'] = {'name': 'DEPLOY_BRANCH', 'type': 'plain_text', 'text': 'develop'}
        with self.assertRaisesRegex(RuntimeError, 'incorrect deployment branch'):
            self.run_deploy()

    def test_missing_branch_fails_readback(self):
        self.after_bindings['DEPLOY_BRANCH'] = None
        with self.assertRaisesRegex(RuntimeError, 'incorrect deployment branch'):
            self.run_deploy()

    def test_wrong_revision_binding_type_fails_readback(self):
        self.after_bindings['DEPLOY_REVISION'] = {'name': 'DEPLOY_REVISION', 'type': 'secret_text', 'text': 'a'*40}
        with self.assertRaisesRegex(RuntimeError, 'incorrect deployment revision'):
            self.run_deploy()

    def test_wrong_branch_binding_type_fails_readback(self):
        self.after_bindings['DEPLOY_BRANCH'] = {'name': 'DEPLOY_BRANCH', 'type': 'secret_text', 'text': 'master'}
        with self.assertRaisesRegex(RuntimeError, 'incorrect deployment branch'):
            self.run_deploy()

    def test_ci_forbids_bootstrap_rotation(self):
        with self.assertRaises(SystemExit): self.run_deploy(['--rotate-setup-token'])
        self.assertEqual(self.writes, [])

    def test_ci_requires_revision(self):
        with self.assertRaises(SystemExit): self.run_deploy(revision=False)
        self.assertEqual(self.writes, [])

    def test_invalid_revision_is_not_normalized(self):
        with self.assertRaises(SystemExit): self.run_deploy(['--revision', 'A'*40])
        self.assertEqual(self.writes, [])

    def test_master_cannot_deploy_to_preview(self):
        with self.assertRaises(SystemExit): self.run_deploy(['--preview'])
        self.assertEqual(self.writes, [])


if __name__ == '__main__':
    unittest.main()
