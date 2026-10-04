"""Offline deployment admission tests; no privileges or network."""
import importlib.machinery
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader('policy', str(ROOT / 'deploy/helm-web-update-policy'))
spec = importlib.util.spec_from_loader(loader.name, loader)
policy = importlib.util.module_from_spec(spec)
loader.exec_module(policy)

class AdmissionTests(unittest.TestCase):
    def test_budget_survives_source_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / 'attempts.json'
            a, b = 'a' * 40, 'b' * 40
            self.assertEqual([policy.admit(ledger, a) for _ in range(4)], [0, 0, 0, 1])
            self.assertEqual(policy.admit(ledger, b), 0)
            self.assertEqual(policy.admit(ledger, a), 1)
            self.assertEqual(ledger.stat().st_mode & 0o777, 0o600)
            self.assertFalse(ledger.with_suffix('.json.tmp').exists())

    def test_recovery_and_uncertain_activation_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / 'receipt.json'
            policy.guard(receipt)
            for phase in ['preparing', 'failed', 'succeeded', 'current', 'retry_exhausted']:
                receipt.write_text(json.dumps({'phase': phase}))
                policy.guard(receipt)
            for text in ['{"phase":"activating"}', '{"phase":"recovery_required"}', '{}', 'bad']:
                receipt.write_text(text)
                with self.assertRaises(ValueError):
                    policy.guard(receipt)
                self.assertEqual(receipt.read_text(), text)

    def test_invalid_ledger_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / 'attempts.json'
            for text in ['bad', '[]', '{"invalid":1}', json.dumps({'a' * 40: -1}), json.dumps({'a' * 40: True})]:
                ledger.write_text(text)
                with self.assertRaises(ValueError):
                    policy.admit(ledger, 'a' * 40)
                self.assertEqual(ledger.read_text(), text)

    def test_fixed_job_and_order(self):
        updater = (ROOT / 'deploy/helm-web-update').read_text()
        self.assertLess(updater.index('flock -n'), updater.index('policy guard'))
        self.assertLess(updater.index('policy guard'), updater.index('write_receipt preparing'))
        self.assertLess(updater.index('write_receipt current'), updater.index('policy admit'))
        self.assertLess(updater.index('policy admit'), updater.index('composer install'))
        timer = (ROOT / 'deploy/helm-web-update.timer').read_text()
        self.assertIn('OnUnitInactiveSec=5min', timer)
        self.assertIn('Unit=helm-web-update.service', timer)
        service = (ROOT / 'deploy/helm-web-update.service').read_text()
        self.assertIn('ExecStart=/usr/local/sbin/helm-web-update run', service)
        self.assertIn('NoNewPrivileges=true', service)

if __name__ == '__main__':
    unittest.main()
