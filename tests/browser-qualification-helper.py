#!/usr/bin/python3 -I
"""Offline adverse contracts; no Root, production auth, host effects or sites."""
import importlib.util
import hashlib
import os
from pathlib import Path
import socket
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

spec = importlib.util.spec_from_file_location('fixture_helper', Path(__file__).resolve().parents[1] / 'deploy/browser-qualification-helper.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='helm-bounded-coordination-')
        self.root = Path(self.temporary.name)
        self.mailbox = self.root / 'original'
        self.mailbox.mkdir(mode=0o700)
        self.broker_dir = self.root / 'benign'
        self.broker_dir.mkdir(mode=0o700)
        self.keypath = self.broker_dir / 'job-key'
        self.keypath.write_bytes(b'x' * 32)
        self.keypath.chmod(0o600)
        now = int(time.time())
        self.binding = {k: str(uuid.uuid4()) for k in ('tenant_id', 'connection_id', 'principal_id', 'vessel_id', 'job_id')}
        self.binding.update(connection_revision=1, created_at=now, expires_at=now + 120)
        self.actor = {k: self.binding[k] for k in helper.ACTOR}
        self.job = helper.Job(self.mailbox, self.binding)
        self.broker = helper.Broker(self.binding, ['a', 'b'])
        self.key = helper.PrivateKey(self.keypath)
        self.transport = helper.AuthenticatedTransfer(self.key, self.binding['job_id'])
        self.request = self.issue({'operation': 'observe_counter', 'label': 'a', 'selector': '#count', 'value': 1})
        self.response = {'schema': 1, 'id': self.request['id'], 'digest': self.request['digest'], 'status': 'observed', 'result': {'counter_matches': True, 'no_input_sent': True}}

    def tearDown(self):
        self.job.close()
        self.key.close()
        self.temporary.cleanup()

    def issue(self, operation):
        request = {'schema': 1, 'id': str(uuid.uuid4()), 'kind': 'cua_web', 'operation': operation, 'expires_at_ms': int(time.time() * 1000) + 45000}
        request['digest'] = hashlib.sha256(helper.encoded(request)).hexdigest()
        self.write(request)
        return request

    def write(self, request):
        path = self.mailbox / (request['id'] + '.request.json')
        path.write_bytes(helper.encoded(request))
        path.chmod(0o600)
        return path

    def register(self):
        self.broker.register(self.job.request_metadata(self.request))

    def test_full_typed_flow_preserves_original_digest_and_one_shot_publication(self):
        self.request['operation']['url'] = 'https://nonsensitive.example.test/fixture'
        self.request['operation']['title'] = 'Synthetic fixture'
        self.request['digest'] = hashlib.sha256(helper.encoded({k: v for k, v in self.request.items() if k != 'digest'})).hexdigest()
        self.write(self.request)
        self.response['digest'] = self.request['digest']
        metadata = self.job.request_metadata(self.request)
        signed = self.transport.sign('request', 1, 'a' * 32, {'action': 'register', 'request': metadata})
        reply = self.transport.accept(signed, self.broker)
        self.assertEqual(self.transport.verify('response', reply, 1, 'a' * 32), {'status': 'ok', 'result': {'registered': True}})
        peek = self.broker.exchange({'protocol': 1, 'action': 'peek', 'actor': self.actor})
        self.assertEqual(set(peek['request']), {'schema', 'id', 'digest', 'expires_at_ms', 'operation', 'label', 'value'})
        self.assertNotIn(b'example', helper.encoded(peek))
        prepared = self.broker.exchange({'protocol': 1, 'action': 'prepare', 'actor': self.actor, 'response': self.response})
        self.assertFalse(list(self.mailbox.glob('*.response.json')))
        self.broker.exchange({'protocol': 1, 'action': 'commit', 'actor': self.actor, 'ticket': prepared['ticket']})
        self.assertEqual(self.broker.peek()['queued'], [self.request['id']])
        self.assertEqual(self.broker.peek()['answered'], [])
        response = self.broker.transfer({'action': 'poll'})['response']
        ticket = self.job.prepare(response)['ticket']
        self.assertEqual(self.job.commit(ticket), {'accepted': True})
        target = self.mailbox / (self.request['id'] + '.response.json')
        self.assertEqual(helper.decoded(target.read_bytes()), self.response)
        self.assertEqual(target.stat().st_mode & 0o777, 0o600)
        self.broker.transfer({'action': 'ack', 'id': self.request['id'], 'digest': self.response['digest']})
        self.assertEqual(self.broker.peek()['answered'], [self.request['id']])
        self.assertIsNone(self.broker.transfer({'action': 'poll'})['response'])
        with self.assertRaises(AssertionError):
            self.broker.prepare(self.response)
        with self.assertRaises(AssertionError):
            self.job.prepare(self.response)
        with self.assertRaises(AssertionError):
            self.broker.transfer({'action': 'ack', 'id': self.request['id'], 'digest': self.response['digest']})

    def test_mac_sequence_nonce_job_and_direction_are_exact(self):
        message = self.transport.sign('request', 1, 'a' * 32, {'action': 'register', 'request': self.job.request_metadata(self.request)})
        for mutate in (lambda m: m.update(job_id=str(uuid.uuid4())), lambda m: m.update(sequence=2), lambda m: m.update(nonce='b' * 32), lambda m: m.update(mac='0' * 64), lambda m: m.update(extra='refused')):
            bad = dict(message)
            mutate(bad)
            with self.assertRaises(AssertionError):
                self.transport.accept(bad, self.broker)
        reply = self.transport.accept(message, self.broker)
        with self.assertRaises(AssertionError):
            self.transport.accept(message, self.broker)
        for direction, sequence, nonce in (('request', 1, 'a' * 32), ('response', 2, 'a' * 32), ('response', 1, 'b' * 32)):
            with self.assertRaises(AssertionError):
                self.transport.verify(direction, reply, sequence, nonce)

    def test_wrong_job_key_and_original_digest_refuse(self):
        other = self.root / 'other-key'
        other.write_bytes(b'y' * 32)
        other.chmod(0o600)
        key = helper.PrivateKey(other)
        try:
            wrong = helper.AuthenticatedTransfer(key, self.binding['job_id'])
            message = wrong.sign('request', 1, 'a' * 32, {'action': 'poll'})
            with self.assertRaises(AssertionError):
                self.transport.accept(message, self.broker)
        finally:
            key.close()
        changed = {**self.request, 'digest': '0' * 64}
        self.write(changed)
        with self.assertRaises(AssertionError):
            self.job.read(changed['id'] + '.request.json')
        self.assertFalse(list(self.mailbox.glob('*.response.json')))

    def test_authenticated_malformed_operation_consumes_sequence_without_echo(self):
        message = self.transport.sign('request', 1, 'a' * 32, {'action': 'exec', 'command': 'never execute'})
        result = self.transport.verify('response', self.transport.accept(message, self.broker), 1, 'a' * 32)
        self.assertEqual(result, {'status': 'refused', 'category': 'fixed_fixture_unavailable'})
        self.assertEqual(self.transport.sequence, 1)
        self.assertEqual(self.broker.records, {})

    def test_registry_cannot_accept_private_fields_unknown_schema_or_changed_issued_request(self):
        metadata = self.job.request_metadata(self.request)
        for bad in ({**metadata, 'schema': True}, {**metadata, 'schema': 2}, {**metadata, 'extra': 'bad'}, {**metadata, 'id': 'not-uuid'}, {**metadata, 'digest': 'bad'}, {**metadata, 'operation': {**metadata['operation'], 'url': 'https://invalid.example'}}, {**metadata, 'operation': {'operation': 'exec', 'label': 'a'}}, {**metadata, 'operation': {'operation': 'observe_counter', 'label': 'foreign', 'value': 1}}):
            with self.assertRaises((AssertionError, ValueError)):
                self.broker.register(bad)
        self.broker.register(metadata)
        changed = {**metadata, 'digest': '0' * 64}
        with self.assertRaises(AssertionError):
            self.broker.register(changed)

    def test_bounded_registry_does_not_drop_or_replace_old_identity(self):
        metadata = self.job.request_metadata(self.request)
        for _ in range(helper.MAX_REQUESTS):
            self.broker.register({**metadata, 'id': str(uuid.uuid4())})
        with self.assertRaises(AssertionError):
            self.broker.register(metadata)
        self.assertEqual(len(self.broker.records), helper.MAX_REQUESTS)

    def test_actor_prepare_commit_gates_and_no_commit_after_refusal(self):
        self.register()
        for key in helper.ACTOR:
            bad = dict(self.actor)
            bad[key] = 2 if key == 'connection_revision' else str(uuid.uuid4())
            with self.assertRaises(AssertionError):
                self.broker.exchange({'protocol': 1, 'action': 'prepare', 'actor': bad, 'response': self.response})
        with self.assertRaises(AssertionError):
            self.broker.actor({**self.actor, 'connection_revision': True})
        ticket = self.broker.prepare(self.response)['ticket']
        bad = {**self.actor, 'connection_revision': 2}
        with self.assertRaises(AssertionError):
            self.broker.exchange({'protocol': 1, 'action': 'commit', 'actor': bad, 'ticket': ticket})
        self.assertIsNone(self.broker.transfer({'action': 'poll'})['response'])
        with patch.object(helper.time, 'monotonic', return_value=self.broker.pending['until'] + .01):
            with self.assertRaises(AssertionError):
                self.broker.commit(ticket)

    def test_wrong_digest_uuid_missing_proof_and_arbitrary_response_fields_refuse(self):
        self.register()
        for bad in ({**self.response, 'digest': '0' * 64}, {**self.response, 'id': str(uuid.uuid4())}, {**self.response, 'schema': True}, {**self.response, 'command': 'bad'}, {**self.response, 'result': {'counter_matches': True}}, {**self.response, 'result': {'counter_matches': True, 'no_input_sent': 'true'}}, {**self.response, 'result': {**self.response['result'], 'url': 'bad'}}):
            with self.assertRaises((AssertionError, KeyError)):
                self.broker.prepare(bad)
        self.assertIsNone(self.broker.pending)

    def test_false_evidence_is_retained_never_coerced_to_pass(self):
        self.register()
        response = {**self.response, 'result': {'counter_matches': False, 'no_input_sent': True}}
        ticket = self.broker.prepare(response)['ticket']
        self.broker.commit(ticket)
        self.assertIs(self.broker.transfer({'action': 'poll'})['response']['result']['counter_matches'], False)

    def test_request_digest_and_original_inode_cannot_change_between_prepare_commit(self):
        issued, identity = next(self.job.requests())
        self.assertEqual(issued['digest'], self.request['digest'])
        ticket = self.job.prepare(self.response)['ticket']
        target = self.mailbox / (self.request['id'] + '.request.json')
        target.unlink()
        self.write(self.request)
        _, substituted_identity = self.job.read(target.name)
        self.assertNotEqual(substituted_identity, identity)
        with self.assertRaises(AssertionError):
            self.job.commit(ticket)
        self.assertFalse(list(self.mailbox.glob('*.response.json')))
        self.assertFalse(list(self.mailbox.glob('*.pending')))

    def test_no_clobber_even_when_existing_response_appears_after_prepare(self):
        ticket = self.job.prepare(self.response)['ticket']
        target = self.mailbox / (self.request['id'] + '.response.json')
        target.write_bytes(b'prior immutable result')
        target.chmod(0o600)
        with self.assertRaises(OSError):
            self.job.commit(ticket)
        self.assertEqual(target.read_bytes(), b'prior immutable result')
        self.assertFalse(list(self.mailbox.glob('*.pending')))

    def test_symlink_fifo_hardlink_open_permissions_and_wrong_uid_refuse(self):
        original = self.mailbox / (self.request['id'] + '.request.json')
        original.unlink()
        original.symlink_to(self.keypath)
        with self.assertRaises(OSError):
            self.job.read(original.name)
        original.unlink()
        os.mkfifo(original, 0o600)
        with self.assertRaises(AssertionError):
            self.job.read(original.name)
        original.unlink()
        self.write(self.request)
        os.link(original, self.root / 'second-link')
        with self.assertRaises(AssertionError):
            self.job.read(original.name)
        (self.root / 'second-link').unlink()
        original.chmod(0o644)
        with self.assertRaises(AssertionError):
            self.job.read(original.name)
        original.chmod(0o600)
        with patch.object(helper.os, 'getuid', return_value=os.getuid() + 1):
            with self.assertRaises(AssertionError):
                self.job.read(original.name)

    def test_key_and_directory_substitution_are_refused(self):
        self.keypath.unlink()
        self.keypath.write_bytes(b'x' * 32)
        self.keypath.chmod(0o600)
        with self.assertRaises(AssertionError):
            self.key.verify()
        moved = self.root / 'moved-original'
        self.mailbox.rename(moved)
        self.mailbox.mkdir(mode=0o700)
        with self.assertRaises(AssertionError):
            self.job.verify()
        alias = self.root / 'alias'
        alias.symlink_to(self.broker_dir)
        with self.assertRaises(AssertionError):
            helper.private_directory(alias)

    def test_wall_monotonic_and_request_expiry_are_all_refusal_boundaries(self):
        with patch.object(helper.time, 'time', return_value=self.binding['expires_at']):
            with self.assertRaises(AssertionError):
                self.broker.verify()
        with patch.object(helper.time, 'monotonic', return_value=self.broker.deadline):
            with self.assertRaises(AssertionError):
                self.broker.verify()
        metadata = self.job.request_metadata(self.request)
        for expiry in (int(time.time() * 1000) - 1, (self.binding['expires_at'] + 1) * 1000):
            with self.assertRaises(AssertionError):
                self.broker.register({**metadata, 'expires_at_ms': expiry})
        with self.assertRaises(AssertionError):
            helper.Broker({**self.binding, 'expires_at': self.binding['created_at'] + 601}, ['a', 'b'])

    def test_decoder_rejects_duplicate_fields_nan_truncation_and_extra_lines(self):
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":', b'x' * (helper.MAX_BYTES + 1)):
            with self.assertRaises((AssertionError, ValueError)):
                helper.decoded(raw)
        for raw in (b'{}', b'{}\n{}\n', b'x' * (helper.MAX_BYTES + 1)):
            left, right = socket.socketpair()
            try:
                left.settimeout(.1)
                right.sendall(raw)
                right.shutdown(socket.SHUT_WR)
                with self.assertRaises((AssertionError, ValueError)):
                    helper.receive(left)
            finally:
                left.close()
                right.close()

    def test_only_predeclared_site_label_and_bounded_expected_counter_cross_channel(self):
        op = {'operation': 'observe_public_site', 'label': 'b', 'site_label': 'documentation', 'selector': '#page', 'url': 'https://benign.example'}
        result = helper.operation_metadata(op, ['a', 'b'], ['documentation', 'media'])
        self.assertEqual(result, {'operation': 'observe_public_site', 'label': 'b', 'site_label': 'documentation'})
        with self.assertRaises(AssertionError):
            helper.operation_metadata(op, ['a', 'b'], ['media'])
        for invalid in (-1, 3, True, '1'):
            with self.assertRaises(AssertionError):
                helper.operation_metadata({'operation': 'observe_counter', 'label': 'a', 'value': invalid}, ['a', 'b'])

    def test_measurement_future_window_labels_counts_and_unknown_preservation(self):
        request = self.issue({'operation': 'measure_arm', 'condition': 'ab_four_viewers', 'index': 0, 'milliseconds': 10000, 'labels': ['a', 'b']})
        helper.validate_result(request, {'started_at_ms': int(time.time() * 1000) + 15000})
        for delta in (-1, 500, 31000):
            with self.assertRaises(AssertionError):
                helper.validate_result(request, {'started_at_ms': int(time.time() * 1000) + delta})
        request['operation']['operation'] = 'measure_window'
        request['operation']['started_at_ms'] = int(time.time() * 1000) + 15000
        sample = {key: 0 for key in helper.NUMBERS}
        sample.update(label='a', status='unknown', scope=helper.SCOPE, metric_scope=helper.METRIC_SCOPE, selected_connection_observed=False, truncated=True)
        result = {'viewers': [sample, {'label': 'b', 'status': 'unavailable'}]}
        helper.validate_result(request, result)
        self.assertEqual(result['viewers'][0]['status'], 'unknown')
        for invalid in (float('nan'), float('inf'), '1', True, -1):
            sample['task_seconds'] = invalid
            with self.assertRaises(AssertionError):
                helper.validate_result(request, result)
        sample['task_seconds'] = 0
        sample['raw_frame'] = 'not accepted'
        with self.assertRaises(AssertionError):
            helper.validate_result(request, result)


class FixedIdleMediaProofContracts(unittest.TestCase):
    def test_label_bound_metadata_and_exact_boolean_response_schema(self):
        for action in ['close_dock_for_idle','reopen_dock_after_idle','observe_media_surfaces','observe_media_frame_change']:
            label='a' if 'idle' in action else 'b'
            op={'operation':action,'label':label}
            self.assertEqual(helper.operation_metadata(op,['a','b']),op)
            required=helper.PROOFS[action]
            request={'operation':op}
            helper.validate_result(request,{key:True for key in required})
            helper.validate_result(request,{key:False for key in required})
            with self.assertRaises(AssertionError):helper.operation_metadata({**op,'label':'b' if label=='a' else 'a'},['a','b'])
            for key in ['url','script','milliseconds','labels','value']:
                with self.assertRaises(AssertionError):helper.operation_metadata({**op,key:'untrusted'},['a','b'])
            for changed in [{}, {**{key:True for key in required},'secret':'untrusted'}, {key:'true' for key in required}]:
                with self.assertRaises(AssertionError):helper.validate_result(request,changed)


if __name__ == '__main__':
    unittest.main()
