// Offline fixture integrity only. These assertions do not implement a reducer
// or claim the owner/client passes the accompanying Rust-derived oracle vectors.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const vectors = JSON.parse(readFileSync(new URL('../fixtures/event-v3/vectors.json', import.meta.url), 'utf8'));
test('oracle vectors remain pinned and explicitly non-live', () => {
    assert.equal(vectors.core_commit, 'ce31fce5f1027b06a416d444eda91e9eba023bd2');
    assert.match(vectors.source_sha256, /^[a-f0-9]{64}$/);
    assert.match(vectors.status, /no production adapter or live conformance claim/);
    assert.equal(new Set(vectors.cases.map(value => value.id)).size, vectors.cases.length);
});
test('fixtures express independent boundaries, not fabricated entity payloads', () => {
    const ids = new Set(vectors.cases.map(value => value.id));
    for (const id of ['generation-mismatch','session_id-mismatch','incarnation-mismatch','barrier-cursor-mismatch','barrier-sequence-mismatch','duplicate-complete-not-silent','chunk-utf8-bytes','chunk-offset-gap','unknown-envelope-field']) assert.ok(ids.has(id), id);
    for (const value of vectors.cases) {
        assert.ok(['InitializationFence::accept','ContentChunk::validate','InitializationEvent serde deny_unknown_fields'].includes(value.definition));
        if (Array.isArray(value.input)) assert.ok(value.input.every(frame => frame.kind !== 'entity'), 'No guessed opaque entity payloads');
    }
});
