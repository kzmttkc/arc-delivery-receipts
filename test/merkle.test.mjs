import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toBytes } from 'viem';
import { leafOf, tree, proofOf, verifyProof } from '../lib/merkle.mjs';
import { judge } from '../lib/judge.mjs';

const rec = (i, delivered = true) => ({ authorization: { nonce: keccak256(toBytes(`n${i}`)), from: '0x' + '11'.repeat(20), to: '0x' + '22'.repeat(20), value: '5000' },
  resourceHash: keccak256(toBytes(`r${i}`)), requestHash: keccak256(toBytes(`q${i}`)), responseHash: keccak256(toBytes(`b${i}`)), delivered });

test('every leaf proves into the root, for odd and even sizes', () => {
  for (const n of [1, 2, 3, 7, 165]) {
    const leaves = Array.from({ length: n }, (_, i) => leafOf(rec(i)));
    const { root, layers } = tree(leaves);
    leaves.forEach((l, i) => assert.ok(verifyProof(l, proofOf(layers, i), root), `n=${n} i=${i}`));
  }
});

test('a changed outcome or response hash no longer proves', () => {
  const leaves = [0, 1, 2, 3].map((i) => leafOf(rec(i)));
  const { root, layers } = tree(leaves);
  assert.equal(verifyProof(leafOf(rec(1, false)), proofOf(layers, 1), root), false);
  assert.equal(verifyProof(leafOf({ ...rec(1), responseHash: keccak256(toBytes('x')) }), proofOf(layers, 1), root), false);
});

test('judge: four stages and outcomes', () => {
  const j = (o) => judge({ status: 200, contentType: 'application/json', bytes: Buffer.from('{"a":1}'), declaredMime: 'application/json', outputSchema: null, ...o });
  assert.equal(j({}).outcome, 'delivered');
  assert.equal(j({ bytes: Buffer.from('{}') }).outcome, 'empty_body');
  assert.equal(j({ contentType: 'text/html' }).outcome, 'wrong_content_type');
  assert.equal(j({ outputSchema: { type: 'object', required: ['b'] } }).outcome, 'schema_mismatch');
  assert.equal(j({ status: 400 }).outcome, 'rejected_after_payment');
  assert.equal(j({ status: 502 }).outcome, 'server_error');
  assert.equal(j({ status: 0, bytes: Buffer.alloc(0) }).outcome, 'no_response');
  assert.equal(j({ declaredMime: null }).stages.mimeMatch, 'n/a');
});
