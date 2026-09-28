// Sorted-pair keccak256 Merkle tree (the OpenZeppelin MerkleProof convention), over one leaf per purchase.
import { keccak256, encodeAbiParameters, concat } from 'viem';

export function leafOf(p) {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bool' }],
    [p.authorization.nonce, p.authorization.from, p.authorization.to, BigInt(p.authorization.value), p.resourceHash, p.requestHash, p.responseHash, p.delivered],
  ));
}
const hashPair = (a, b) => keccak256(a.toLowerCase() < b.toLowerCase() ? concat([a, b]) : concat([b, a]));
export function tree(leaves) {
  const layers = [leaves.slice()];
  while (layers.at(-1).length > 1) {
    const cur = layers.at(-1), next = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? hashPair(cur[i], cur[i + 1]) : cur[i]);
    layers.push(next);
  }
  return { root: layers.at(-1)[0], layers };
}
export function proofOf(layers, index) {
  const proof = [];
  for (let l = 0; l < layers.length - 1; l++) {
    const sib = index ^ 1;
    if (sib < layers[l].length) proof.push(layers[l][sib]);
    index >>= 1;
  }
  return proof;
}
export const verifyProof = (leaf, proof, root) => proof.reduce((h, s) => hashPair(h, s), leaf).toLowerCase() === root.toLowerCase();
