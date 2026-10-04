"""Execute updater control flow in a temp sandbox with privileged effects mocked."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class UpdaterTests(unittest.TestCase):
    def run_case(self, installed, probe, cloned, ledger=None, receipt=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'app').mkdir()
            (root / 'deployments').mkdir()
            (root / 'app/.helm-source').write_text(installed)
            if ledger is not None:
                (root / 'deployments/helm-web-attempts.json').write_text(json.dumps(ledger))
            if receipt is not None:
                (root / 'deployments/helm-web-self-update.json').write_text(json.dumps(receipt))
            script = (ROOT / 'deploy/helm-web-update').read_text()
            script = script.replace('root=/srv/helm', f'root={root}')
            script = script.replace('[[ $EUID == 0 ]]', '[[ 1 == 1 ]]')
            script = script.replace('exec 9>/run/lock/helm-web-update.lock', f'exec 9>{root}/lock')
            script = script.replace('/usr/local/libexec/helm-web-update-policy', f'python3 {ROOT}/deploy/helm-web-update-policy')
            # Keep real temp files, atomic receipts, ledger and shell error/trap semantics.
            start = script.index('as_helm() {')
            end = script.index('\n\nrestore_previous()', start)
            mocks = f'''as_helm() {{
    echo "$*" >> "$root/calls"
    case "$1 $2" in
        'git ls-remote') printf '%s\\trefs/heads/main\\n' '{probe}';;
        'git clone') return 0;;
        'git -C') echo '{cloned}';;
        'composer install') return 17;;
        *) return 0;;
    esac
}}
chown() {{ :; }}
install() {{ local last=${{@: -1}}; mkdir -p "$last"; }}
'''
            script = script[:start] + mocks + script[end:]
            result = subprocess.run(['bash', '-c', script, 'updater', 'run'], capture_output=True, text=True)
            calls = (root / 'calls').read_text() if (root / 'calls').exists() else ''
            state = json.loads((root / 'deployments/helm-web-self-update.json').read_text())
            attempts = json.loads((root / 'deployments/helm-web-attempts.json').read_text()) if (root / 'deployments/helm-web-attempts.json').exists() else {}
            return result, calls, state, attempts, list(root.glob('update-stage.*')), (root / 'backups').exists()

    def test_unchanged_has_no_clone_stage_backup_build(self):
        result, calls, receipt, ledger, stages, backups = self.run_case('a'*40, 'a'*40, 'b'*40)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('clone', calls)
        self.assertNotIn('composer', calls)
        self.assertEqual(receipt['phase'], 'current')
        self.assertEqual(ledger, {})
        self.assertEqual(stages, [])
        self.assertFalse(backups)

    def test_exhausted_has_no_clone_stage_backup_build(self):
        result, calls, receipt, ledger, stages, backups = self.run_case('a'*40, 'b'*40, 'c'*40, {'b'*40: 3})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('clone', calls)
        self.assertNotIn('composer', calls)
        self.assertEqual(receipt['phase'], 'retry_exhausted')
        self.assertEqual(stages, [])
        self.assertFalse(backups)

    def test_race_actual_clone_controls_exhaustion(self):
        result, calls, receipt, ledger, stages, backups = self.run_case('a'*40, 'b'*40, 'c'*40, {'c'*40: 3})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('clone', calls)
        self.assertNotIn('composer', calls)
        self.assertEqual(receipt['source'], 'c'*40)
        self.assertEqual(receipt['phase'], 'retry_exhausted')
        self.assertNotIn('b'*40, ledger)
        self.assertEqual(stages, [])
        self.assertFalse(backups)

    def test_race_actual_clone_failure_consumes_actual_budget(self):
        result, calls, receipt, ledger, stages, backups = self.run_case('a'*40, 'b'*40, 'c'*40)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertEqual(receipt['source'], 'c'*40)
        self.assertEqual(receipt['phase'], 'failed')
        self.assertEqual(ledger, {'c'*40: 1})
        self.assertFalse(backups)
        self.assertEqual(stages, [])

    def test_recovery_fence_preserves_receipt(self):
        result, calls, receipt, ledger, stages, backups = self.run_case('a'*40, 'b'*40, 'c'*40, receipt={'phase': 'recovery_required', 'source': 'a'*40})
        self.assertEqual(result.returncode, 2)
        self.assertEqual(calls, '')
        self.assertEqual(receipt['phase'], 'recovery_required')
        self.assertEqual(stages, [])
        self.assertFalse(backups)

if __name__ == '__main__':
    unittest.main()
