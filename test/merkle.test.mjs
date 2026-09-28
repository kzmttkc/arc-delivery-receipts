import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toBytes } from 'viem';
import { leafOf, leafV1, leafFor, tree, proofOf, verifyProof } from '../lib/merkle.mjs';
import { checks, verdict } from '../lib/judge.mjs';

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

test('v1 leaf commits status; changing it breaks the proof', () => {
  const r = (i, status) => ({ ...rec(i), leafVersion: 1, status });
  const leaves = [0, 1, 2].map((i) => leafFor(r(i, 200)));
  const { root, layers } = tree(leaves);
  assert.ok(verifyProof(leafV1(r(1, 200)), proofOf(layers, 1), root));
  assert.equal(verifyProof(leafV1(r(1, 500)), proofOf(layers, 1), root), false);
  assert.notEqual(leafV1(r(1, 200)), leafOf(rec(1)));
});

test('checks and charge-aware verdicts', () => {
  const c = (o) => checks({ status: 200, contentType: 'application/json', bytes: Buffer.from('{"a":1}'), declaredMime: 'application/json', outputSchema: null, ...o });
  assert.equal(c({}).passed, true);
  assert.equal(c({ bytes: Buffer.from('[]') }).emptyResult, true);
  assert.equal(c({ bytes: Buffer.from('[]') }).passed, true);
  assert.equal(c({ bytes: Buffer.alloc(0) }).passed, false);
  assert.equal(c({ contentType: 'text/html' }).passed, false);
  assert.equal(c({ outputSchema: { type: 'object', required: ['b'] } }).passed, false);
  assert.equal(verdict({ status: 200, passed: true }, true), 'delivered');
  assert.equal(verdict({ status: 400, passed: false }, true), 'charged_then_rejected');
  assert.equal(verdict({ status: 502, passed: false }, true), 'charged_server_error');
  assert.equal(verdict({ status: 400, passed: false }, false), 'refused_not_charged');
  assert.equal(verdict({ status: 402, passed: false }, false), 'payment_not_accepted');
  assert.equal(verdict({ status: 200, passed: true }, false), 'served_not_charged');
});
