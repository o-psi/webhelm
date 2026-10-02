#!/usr/bin/python3 -I
"""Fixed, expiring BENIGN benchmark coordination, never a command/credential RPC.

broker: PHP's ordinary UID owns a NEW private Unix socket and job-only key.
bridge: executing user's UID reads its original private driver mailbox. It uses
only HMAC-authenticated loopback TCP to transfer whitelisted metadata/results.
No process reads another UID's files. Original responses are published solely by
bridge, against the issued digest/inode, with atomic no-clobber publication.
"""
import argparse
import ctypes
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import stat
import struct
import time
import uuid

MAX_BYTES = 65536
MAX_REQUESTS = 64
PROOFS = {
    'open_fixture': {'authenticated_existing_session', 'exact_selected_voyage', 'browser_dock_open', 'fixture_visible', 'counter_matches', 'other_web_tab_retained'},
    'observe_counter': {'counter_matches', 'no_input_sent'},
    'observe_public_site': {'fixture_visible', 'no_input_sent'},
    'observe_site_classes': {'external_css', 'open_shadow', 'authenticated_image', 'cross_origin_child', 'nested_child', 'no_input_sent'},
    'nested_child_once_return': {'dynamic_action_observed', 'cross_origin_action_observed', 'nested_action_dispatched_once', 'nested_action_observed', 'continue_agent_explicit', 'no_unknown_effect_retried'},
    'observe_private_exclusion': {'no_replay_iframe', 'address_blank', 'watching_private', 'no_input_sent'},
    'private_reclaim_return': {'browse_privately_confirmed', 'private_retained_until_explicit_return', 'synthetic_private_page_cleared_before_return', 'continue_agent_explicit', 'new_benign_click_once', 'counter_one_visible', 'no_unknown_effect_retried'},
    'observe_real_renewal': {'both_actual_connections_renewed', 'browser_identity_retained', 'no_effect_replay', 'no_transport_rewrite'},
    'close_browser_once': {'close_dispatched_once', 'browser_stopped', 'outcome_confirmed'},
    'close_fixture_panels': {'only_owned_fixture_tabs_closed', 'unrelated_tabs_retained'},
    'close_dock_for_idle': {'dock_closed', 'qualification_tab_retained', 'other_browser_unchanged', 'no_browser_start_or_close'},
    'reopen_dock_after_idle': {'dock_open', 'same_running_browser', 'fresh_attach', 'other_browser_unchanged', 'no_browser_start_or_close'},
    'observe_media_surfaces': {'all_three_visible', 'canvas_decoded_content_changes', 'video_decoded_content_changes', 'video_playback_frames_advance', 'same_surface_versions_advance', 'unsupported_frame_orange', 'no_input_sent'},
    'observe_media_frame_change': {'all_three_visible', 'unsupported_frame_blue', 'same_unsupported_surface_version_advance', 'no_input_sent'},
}
SCOPE = 'actual CUA qualification Web tab renderer and public WSS application payload'
METRIC_SCOPE = 'selected target renderer metrics; renderer/process sharing is possible, so do not sum task/heap across tabs'
NUMBERS = {'captured_at_ms', 'elapsed_ms', 'task_seconds', 'heap_used_bytes', 'heap_delta_bytes', 'nodes', 'node_delta', 'sent_bytes', 'received_bytes', 'sent_frames', 'received_frames', 'renewal_acks', 'duplicate_effects', 'unknown_effects', 'refused_effects', 'pending_effects', 'child_targets_observed'}
BOOLS = {'selected_connection_observed', 'truncated'}
ACTOR = {'tenant_id', 'connection_id', 'connection_revision', 'principal_id', 'vessel_id'}
SAFE_FIELDS = {'label', 'labels', 'condition', 'index', 'milliseconds', 'started_at_ms', 'site_label', 'value', 'counter'}
CONDITIONS = {'a_one_viewer', 'a_two_viewers', 'ab_four_viewers'}


def encoded(value):
    raw = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    assert len(raw) < MAX_BYTES
    return raw


def decoded(raw):
    assert len(raw) <= MAX_BYTES
    def pairs(items):
        result = {}
        for key, value in items:
            assert key not in result
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('invalid number')))


def canonical_uuid(value):
    assert isinstance(value, str) and str(uuid.UUID(value)) == value
    return value


def file_identity(meta):
    return (meta.st_dev, meta.st_ino, meta.st_size, meta.st_mtime_ns, meta.st_ctime_ns)


def private_directory(path):
    path = Path(path)
    assert path.is_absolute() and path.resolve() == path
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        meta = os.fstat(fd)
        assert meta.st_uid == os.getuid() and not meta.st_mode & 0o077
        return fd, (meta.st_dev, meta.st_ino)
    except BaseException:
        os.close(fd)
        raise


def verify_directory(path, fd, inode):
    current, held = path.lstat(), os.fstat(fd)
    assert stat.S_ISDIR(current.st_mode) and (current.st_dev, current.st_ino) == inode
    assert (held.st_dev, held.st_ino) == inode
    assert all(m.st_uid == os.getuid() and not m.st_mode & 0o077 for m in (current, held))


def private_read(fd, name):
    source_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd)
    with os.fdopen(source_fd, 'rb') as source:
        meta = os.fstat(source.fileno())
        assert stat.S_ISREG(meta.st_mode) and meta.st_uid == os.getuid() and meta.st_nlink == 1
        assert not meta.st_mode & 0o077 and meta.st_size <= MAX_BYTES
        raw = source.read(MAX_BYTES + 1)
        assert file_identity(meta) == file_identity(os.fstat(source.fileno()))
        assert file_identity(meta) == file_identity(os.stat(name, dir_fd=fd, follow_symlinks=False))
        assert len(raw) <= MAX_BYTES
    return raw, file_identity(meta)


class PrivateKey:
    def __init__(self, path):
        self.path = Path(path)
        self.fd, self.directory_inode = private_directory(self.path.parent)
        try:
            self.value, self.inode = private_read(self.fd, self.path.name)
            assert len(self.value) == 32
        except BaseException:
            os.close(self.fd)
            raise

    def verify(self):
        verify_directory(self.path.parent, self.fd, self.directory_inode)
        raw, inode = private_read(self.fd, self.path.name)
        assert inode == self.inode and hmac.compare_digest(raw, self.value)

    def close(self):
        os.close(self.fd)


def operation_metadata(op, labels, site_labels=()):
    assert isinstance(op, dict) and op.get('operation') in set(PROOFS) | {'measure_arm', 'measure_window'}
    result = {'operation': op['operation']}
    # Only the signed original driver can supply rich private fixture parameters;
    # URLs, selectors, paths, titles and input strings never cross this channel.
    for key in SAFE_FIELDS:
        if key in op:
            result[key] = op[key]
    if 'label' in result:
        assert result['label'] in labels
    if 'labels' in result:
        assert isinstance(result['labels'], list) and 1 <= len(result['labels']) <= 2
        assert len(set(result['labels'])) == len(result['labels']) and all(s in labels for s in result['labels'])
    action = result['operation']
    if action in {'close_dock_for_idle','reopen_dock_after_idle','observe_media_surfaces','observe_media_frame_change'}:
        assert set(op) == {'operation','label'} and set(result) == {'operation','label'}
        expected = labels[0] if action in {'close_dock_for_idle','reopen_dock_after_idle'} else labels[1]
        assert result['label'] == expected
        return result
    if action.startswith('measure_'):
        keys = {'operation', 'condition', 'index', 'milliseconds', 'labels'}
        if action == 'measure_window':
            keys.add('started_at_ms')
        assert set(result) == keys and result['condition'] in CONDITIONS
        assert type(result['index']) is int and 0 <= result['index'] <= 2
        assert type(result['milliseconds']) is int and result['milliseconds'] == 10000
        if action == 'measure_window':
            assert type(result['started_at_ms']) is int and result['started_at_ms'] > 0
    else:
        keys = {'operation', 'label', 'labels'}
        if action == 'observe_public_site':
            keys.add('site_label')
            assert result.get('site_label') in site_labels
        if action == 'observe_counter':
            keys.add('value')
            assert type(result.get('value')) is int and 0 <= result['value'] <= 2
        if action == 'open_fixture':
            keys.add('counter')
            assert type(result.get('counter')) is int and 0 <= result['counter'] <= 2
        assert set(result) <= keys
        assert ('label' in result) != ('labels' in result)
    return result


def validate_result(request, result):
    assert isinstance(result, dict)
    op, action = request['operation'], request['operation']['operation']
    if action in PROOFS:
        required = PROOFS[action]
        if action == 'open_fixture':
            required = required - {'other_web_tab_retained'}
        assert required <= set(result) <= PROOFS[action] and all(type(v) is bool for v in result.values())
    elif action == 'measure_arm':
        assert set(result) == {'started_at_ms'} and type(result['started_at_ms']) is int
        assert 1000 <= result['started_at_ms'] - int(time.time() * 1000) <= 30000
    else:
        assert set(result) == {'viewers'} and isinstance(result['viewers'], list) and len(result['viewers']) == len(op['labels'])
        for value, label in zip(result['viewers'], op['labels']):
            assert isinstance(value, dict) and value.get('label') == label
            if value.get('status') == 'unavailable':
                assert set(value) == {'label', 'status'}
                continue
            assert set(value) == NUMBERS | BOOLS | {'label', 'status', 'scope', 'metric_scope'}
            assert value['status'] in ('observed', 'unknown') and value['scope'] == SCOPE and value['metric_scope'] == METRIC_SCOPE
            for key in NUMBERS:
                number = value[key]
                if key != 'task_seconds':
                    assert type(number) is int
                assert type(number) in (int, float) and math.isfinite(number) and abs(number) <= 2**53 - 1
                if key not in ('heap_delta_bytes', 'node_delta'):
                    assert number >= 0
            assert all(type(value[key]) is bool for key in BOOLS)


class Lifetime:
    def __init__(self, binding, labels, site_labels=()):
        assert set(binding) == ACTOR | {'job_id', 'created_at', 'expires_at'}
        for key in ACTOR - {'connection_revision'} | {'job_id'}:
            canonical_uuid(binding[key])
        assert type(binding['connection_revision']) is int and binding['connection_revision'] >= 1
        assert type(binding['created_at']) is int and type(binding['expires_at']) is int
        assert 0 < binding['expires_at'] - binding['created_at'] <= 600
        assert binding['created_at'] <= time.time() < binding['expires_at']
        self.binding, self.labels = binding, tuple(labels)
        assert len(self.labels) == 2 and len(set(self.labels)) == 2
        assert all(isinstance(s, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,40}', s) for s in self.labels)
        self.site_labels = tuple(site_labels)
        assert len(self.site_labels) <= 4 and len(set(self.site_labels)) == len(self.site_labels)
        assert all(isinstance(s, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,40}', s) for s in self.site_labels)
        self.deadline = time.monotonic() + min(600, binding['expires_at'] - time.time())

    def verify(self):
        assert time.time() < self.binding['expires_at'] and time.monotonic() < self.deadline

    def actor(self, actor):
        assert isinstance(actor, dict) and set(actor) == ACTOR
        assert type(actor['connection_revision']) is int
        for key in ACTOR - {'connection_revision'}:
            canonical_uuid(actor[key])
        assert actor == {key: self.binding[key] for key in ACTOR}

    def request_metadata(self, request):
        self.verify()
        assert isinstance(request, dict) and set(request) == {'schema', 'id', 'kind', 'operation', 'expires_at_ms', 'digest'}
        assert type(request['schema']) is int and request['schema'] == 1 and request['kind'] == 'cua_web'
        canonical_uuid(request['id'])
        assert isinstance(request['digest'], str) and re.fullmatch(r'[0-9a-f]{64}', request['digest'])
        assert type(request['expires_at_ms']) is int and int(time.time() * 1000) < request['expires_at_ms'] <= self.binding['expires_at'] * 1000
        result = dict(request)
        result['operation'] = operation_metadata(request['operation'], self.labels, self.site_labels)
        return result


class Job(Lifetime):
    """Original private UID1000 driver mailbox, never opened by PHP/broker."""
    def __init__(self, mailbox, binding, labels=('a', 'b'), site_labels=()):
        super().__init__(binding, labels, site_labels)
        self.path = Path(mailbox)
        self.fd, self.inode = private_directory(mailbox)
        self.pending = None

    def close(self):
        os.close(self.fd)

    def verify(self):
        super().verify()
        verify_directory(self.path, self.fd, self.inode)

    def read(self, name):
        self.verify()
        assert re.fullmatch(r'[0-9a-f-]{36}\.request\.json', name)
        raw, identity = private_read(self.fd, name)
        self.verify()
        request = decoded(raw)
        self.request_metadata(request)
        assert name == request['id'] + '.request.json'
        base = {k: v for k, v in request.items() if k != 'digest'}
        assert hmac.compare_digest(request['digest'], hashlib.sha256(encoded(base)).hexdigest())
        return request, identity

    def requests(self):
        self.verify()
        names = os.listdir(self.fd)
        assert len(names) <= 160
        for name in sorted(names):
            if re.fullmatch(r'[0-9a-f-]{36}\.request\.json', name) and name.replace('.request.json', '.response.json') not in names:
                request, identity = self.read(name)
                yield self.request_metadata(request), identity

    def prepare(self, response):
        self.verify()
        assert self.pending is None or self.pending['until'] < time.monotonic()
        assert isinstance(response, dict) and set(response) == {'schema', 'id', 'digest', 'status', 'result'}
        assert type(response['schema']) is int and response['schema'] == 1 and response['status'] == 'observed'
        canonical_uuid(response['id'])
        request, identity = self.read(response['id'] + '.request.json')
        assert response['digest'] == request['digest']
        validate_result(request, response['result'])
        assert not os.path.lexists(self.path / (response['id'] + '.response.json'))
        ticket = os.urandom(32).hex()
        self.pending = {'ticket': ticket, 'response': response, 'raw': encoded(response), 'identity': identity, 'until': time.monotonic() + 5}
        return {'ticket': ticket}

    def commit(self, ticket):
        self.verify()
        pending = self.pending
        assert pending and pending['until'] >= time.monotonic() and ticket == pending['ticket']
        request, identity = self.read(pending['response']['id'] + '.request.json')
        assert identity == pending['identity'] and request['digest'] == pending['response']['digest']
        target = pending['response']['id'] + '.response.json'
        temporary = '.' + uuid.uuid4().hex + '.pending'
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=self.fd)
        try:
            with os.fdopen(fd, 'wb') as output:
                output.write(pending['raw'])
                output.flush()
                os.fsync(output.fileno())
            self.verify()
            # Linux atomic publication: never replace an existing result, even
            # if a different process races the preceding absence observation.
            libc = ctypes.CDLL(None, use_errno=True)
            function = libc.renameat2
            function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
            function.restype = ctypes.c_int
            if function(self.fd, temporary.encode(), self.fd, target.encode(), 1) != 0:
                raise OSError(ctypes.get_errno(), 'fixed no-clobber publication refused')
            os.fsync(self.fd)
            self.pending = None
            return {'accepted': True}
        finally:
            try:
                os.unlink(temporary, dir_fd=self.fd)
            except FileNotFoundError:
                pass


class Broker(Lifetime):
    """UID33 stores at most 64 signed BENIGN records, never original files."""
    def __init__(self, binding, labels, site_labels=()):
        super().__init__(binding, labels, site_labels)
        self.records, self.pending = {}, None

    def register(self, request):
        sanitized = self.request_metadata(request)
        assert sanitized == request  # No URL/selector/path/string extras allowed.
        existing = self.records.get(request['id'])
        if existing:
            assert existing['request'] == request
        else:
            assert len(self.records) < MAX_REQUESTS
            self.records[request['id']] = {'request': request, 'response': None, 'acknowledged': False}
        return {'registered': True}

    def peek(self):
        self.verify()
        answered, queued, current = [], [], None
        for record in self.records.values():
            request = record['request']
            if record['acknowledged']:
                answered.append(request['id'])
            elif record['response'] is not None:
                queued.append(request['id'])
            elif current is None and request['expires_at_ms'] > int(time.time() * 1000):
                current = {k: request[k] for k in ('schema', 'id', 'digest', 'expires_at_ms')}
                current.update(request['operation'])
        return {'request': current, 'queued': queued, 'answered': answered, 'expires_at': self.binding['expires_at']}

    def prepare(self, response):
        self.verify()
        assert self.pending is None or self.pending['until'] < time.monotonic()
        assert isinstance(response, dict) and set(response) == {'schema', 'id', 'digest', 'status', 'result'}
        assert type(response['schema']) is int and response['schema'] == 1 and response['status'] == 'observed'
        canonical_uuid(response['id'])
        record = self.records[response['id']]
        self.request_metadata(record['request'])
        assert not record['acknowledged'] and record['response'] is None
        assert response['digest'] == record['request']['digest']
        validate_result(record['request'], response['result'])
        encoded(response)
        ticket = os.urandom(32).hex()
        self.pending = {'ticket': ticket, 'response': response, 'until': time.monotonic() + 5}
        return {'ticket': ticket}

    def commit(self, ticket):
        self.verify()
        pending = self.pending
        assert pending and pending['until'] >= time.monotonic() and ticket == pending['ticket']
        record = self.records[pending['response']['id']]
        self.request_metadata(record['request'])
        assert not record['acknowledged'] and record['response'] is None
        record['response'] = pending['response']
        self.pending = None
        # accepted means queued for bridge, NOT evidence already published.
        return {'accepted': True}

    def exchange(self, message):
        self.verify()
        assert isinstance(message, dict) and type(message.get('protocol')) is int and message['protocol'] == 1
        action = message.get('action')
        if action == 'binding':
            assert set(message) == {'protocol', 'action'}
            return self.binding
        assert action in ('peek', 'prepare', 'commit')
        self.actor(message.get('actor'))
        if action == 'peek':
            assert set(message) == {'protocol', 'action', 'actor'}
            return self.peek()
        if action == 'prepare':
            assert set(message) == {'protocol', 'action', 'actor', 'response'}
            return self.prepare(message['response'])
        assert set(message) == {'protocol', 'action', 'actor', 'ticket'}
        return self.commit(message['ticket'])

    def transfer(self, payload):
        self.verify()
        assert isinstance(payload, dict)
        if payload.get('action') == 'register':
            assert set(payload) == {'action', 'request'}
            return self.register(payload['request'])
        if payload.get('action') == 'poll':
            assert set(payload) == {'action'}
            response = next((r['response'] for r in self.records.values() if r['response'] is not None and not r['acknowledged']), None)
            return {'response': response}
        assert set(payload) == {'action', 'id', 'digest'} and payload['action'] == 'ack'
        canonical_uuid(payload['id'])
        record = self.records[payload['id']]
        assert record['response'] is not None and record['response']['digest'] == payload['digest']
        assert not record['acknowledged']
        record['acknowledged'] = True
        record['response'] = None
        return {'acknowledged': True}


class AuthenticatedTransfer:
    def __init__(self, key, job_id):
        self.key, self.job_id, self.sequence = key, canonical_uuid(job_id), 0

    def sign(self, direction, sequence, nonce, payload):
        self.key.verify()
        message = {'protocol': 1, 'job_id': self.job_id, 'sequence': sequence, 'nonce': nonce, 'payload': payload}
        message['mac'] = hmac.new(self.key.value, direction.encode() + b'\0' + encoded(message), hashlib.sha256).hexdigest()
        encoded(message)
        return message

    def verify(self, direction, message, sequence=None, nonce=None):
        self.key.verify()
        assert isinstance(message, dict) and set(message) == {'protocol', 'job_id', 'sequence', 'nonce', 'payload', 'mac'}
        assert type(message['protocol']) is int and message['protocol'] == 1 and message['job_id'] == self.job_id
        assert type(message['sequence']) is int and 1 <= message['sequence'] <= 20000
        assert isinstance(message['nonce'], str) and re.fullmatch(r'[0-9a-f]{32}', message['nonce'])
        assert isinstance(message['mac'], str) and re.fullmatch(r'[0-9a-f]{64}', message['mac'])
        expected = self.sign(direction, message['sequence'], message['nonce'], message['payload'])['mac']
        assert hmac.compare_digest(expected, message['mac'])
        if sequence is not None:
            assert message['sequence'] == sequence
        if nonce is not None:
            assert message['nonce'] == nonce
        return message['payload']

    def accept(self, message, broker):
        payload = self.verify('request', message, self.sequence + 1)
        self.sequence += 1  # Even a well-authenticated malformed operation cannot replay.
        try:
            result = {'status': 'ok', 'result': broker.transfer(payload)}
        except Exception:
            result = {'status': 'refused', 'category': 'fixed_fixture_unavailable'}
        return self.sign('response', self.sequence, message['nonce'], result)

    def call(self, port, payload):
        self.sequence += 1
        nonce = os.urandom(16).hex()
        request = self.sign('request', self.sequence, nonce, payload)
        with socket.create_connection(('127.0.0.1', port), timeout=1) as peer:
            peer.settimeout(1)
            peer.sendall(encoded(request) + b'\n')
            response = self.verify('response', receive(peer), self.sequence, nonce)
        assert isinstance(response, dict) and set(response) == {'status', 'result'} and response['status'] == 'ok'
        return response['result']


def receive(peer):
    data = bytearray()
    while b'\n' not in data:
        chunk = peer.recv(min(8192, MAX_BYTES + 1 - len(data)))
        assert chunk
        data.extend(chunk)
        assert len(data) <= MAX_BYTES
    assert data.endswith(b'\n') and data.count(b'\n') == 1
    return decoded(data[:-1])


def run_broker(args, binding, key):
    path = Path(args.socket)
    assert len(os.fsencode(path)) <= 103 and path.is_absolute()
    parent_fd, parent_inode = private_directory(path.parent)
    broker = Broker(binding, args.labels, args.site_labels)
    transfer = AuthenticatedTransfer(key, args.job_id)
    local = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    selector = selectors.DefaultSelector()
    local.bind(str(path))
    os.chmod(path, 0o600)
    local.listen(4)
    tcp.bind(('127.0.0.1', args.port))
    tcp.listen(4)
    selector.register(local, selectors.EVENT_READ, 'local')
    selector.register(tcp, selectors.EVENT_READ, 'tcp')
    meta = path.lstat()
    raw = Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()
    # Only nonsensitive fixture pins/port. No key, production credential or requests.
    print(json.dumps({'job_id': args.job_id, 'socket': str(path), 'socket_dev': meta.st_dev, 'socket_ino': meta.st_ino,
        'directory_dev': parent_inode[0], 'directory_ino': parent_inode[1], 'helper_pid': os.getpid(),
        'helper_start_ticks': int(raw[19]), 'port': tcp.getsockname()[1]}), flush=True)
    try:
        while time.monotonic() < broker.deadline and time.time() < binding['expires_at']:
            key.verify()
            verify_directory(path.parent, parent_fd, parent_inode)
            assert file_identity(path.lstat()) == file_identity(meta)
            for ready, _ in selector.select(.1):
                peer, address = ready.fileobj.accept()
                with peer:
                    peer.settimeout(1)
                    try:
                        if ready.data == 'local':
                            _, uid, _ = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                            assert uid == os.getuid()
                            reply = {'status': 'ok', 'result': broker.exchange(receive(peer))}
                        else:
                            assert address[0] == '127.0.0.1'
                            reply = transfer.accept(receive(peer), broker)
                    except Exception:
                        reply = {'status': 'refused', 'category': 'fixed_fixture_unavailable'}
                    try:
                        peer.sendall(encoded(reply) + b'\n')
                    except OSError:
                        pass  # Unconfirmed response is never retried or fabricated.
    finally:
        selector.close()
        local.close()
        tcp.close()
        current = path.lstat()
        if (current.st_dev, current.st_ino) == (meta.st_dev, meta.st_ino):
            path.unlink()
        os.close(parent_fd)


def run_bridge(args, binding, key):
    job = Job(args.mailbox, binding, args.labels, args.site_labels)
    transfer = AuthenticatedTransfer(key, args.job_id)
    registered = {}
    try:
        while time.monotonic() < job.deadline and time.time() < binding['expires_at']:
            job.verify()
            key.verify()
            for request, identity in job.requests():
                known = registered.get(request['id'])
                if known is None:
                    assert len(registered) < MAX_REQUESTS
                    assert transfer.call(args.port, {'action': 'register', 'request': request}) == {'registered': True}
                    registered[request['id']] = {'digest': request['digest'], 'identity': identity}
                else:
                    assert known == {'digest': request['digest'], 'identity': identity}
            result = transfer.call(args.port, {'action': 'poll'})
            assert isinstance(result, dict) and set(result) == {'response'}
            response = result['response']
            if response is not None:
                assert isinstance(response, dict)
                registered_request = registered.get(response.get('id'))
                assert registered_request and registered_request['digest'] == response.get('digest')
                _, identity = job.read(response['id'] + '.request.json')
                assert identity == registered_request['identity']
                prepared = job.prepare(response)
                assert job.commit(prepared['ticket']) == {'accepted': True}
                assert transfer.call(args.port, {'action': 'ack', 'id': response['id'], 'digest': response['digest']}) == {'acknowledged': True}
            time.sleep(.1)
    finally:
        job.close()


def main():
    if not __debug__ or os.getuid() == 0:
        raise RuntimeError('Ordinary UID and Python validation required.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('broker', 'bridge'))
    for key in ('key-file', 'job-id', 'tenant-id', 'connection-id', 'principal-id', 'vessel-id'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--connection-revision', type=int, required=True)
    parser.add_argument('--created-at', type=int, required=True)
    parser.add_argument('--expires-at', type=int, required=True)
    parser.add_argument('--labels', nargs=2, required=True)
    parser.add_argument('--site-labels', nargs='*', default=[])
    parser.add_argument('--socket')
    parser.add_argument('--mailbox')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    assert (args.port == 0 or 1024 <= args.port <= 65535) and (args.mode == 'broker' and args.socket and not args.mailbox or args.mode == 'bridge' and args.mailbox and not args.socket and args.port >= 1024)
    binding = {k: getattr(args, k) for k in ('job_id', 'tenant_id', 'connection_id', 'connection_revision', 'principal_id', 'vessel_id', 'created_at', 'expires_at')}
    Lifetime(binding, args.labels, args.site_labels)
    def stop(_signal, _frame):
        raise RuntimeError('Fixed fixture stopped.')
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    os.umask(0o077)
    key = PrivateKey(args.key_file)
    try:
        (run_broker if args.mode == 'broker' else run_bridge)(args, binding, key)
    finally:
        key.close()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not expose CLI fixture paths or rejected private input in tracebacks.
        raise SystemExit('Fixed fixture coordination stopped or refused; no acceptance inferred.')
