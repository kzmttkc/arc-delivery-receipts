// Independent verifier. Trusts nothing but the published round file, Arc RPC and Circle's public Gateway API.
// Usage: node verify.mjs public/rounds/1/records.json
//   1. each payment authorization is signed by the buyer (EIP-712, GatewayWalletBatched domain on Arc)
//   2. each record's leaf proves into the Merkle root stored on Arc in DeliveryLedger
//   3. Circle's Gateway API maps each authorization nonce to a completed batch settlement tx on Arc
//   4. in each settlement tx, the buyer's Gateway balance fell by exactly the sum of its authorizations in that tx
//   5. counts: delivered/not delivered and every stage, recomputed from the records
import fs from 'node:fs';
import { createPublicClient, http, verifyTypedData, parseAbi, getAddress } from 'viem';
import { leafOf, verifyProof } from './lib/merkle.mjs';
import { STAGES } from './lib/judge.mjs';

const file = process.argv[2] ?? 'public/rounds/1/records.json';
const ARC_RPC = process.env.ARC_RPC || 'https://rpc.mainnet.arc.io';
const GATEWAY_API = 'https://gateway-api.circle.com/v1';
const USDC = '0x3600000000000000000000000000000000000000';
const arc = createPublicClient({ transport: http(ARC_RPC, { retryCount: 5, timeout: 60_000 }) });
const round = JSON.parse(fs.readFileSync(file, 'utf8'));
const paid = round.records.filter((r) => r.authorization);
const buyer = getAddress(paid[0].authorization.from);
const ledgerAbi = parseAbi(['function roundOf(uint256) view returns ((bytes32 root,uint32 purchases,uint32 delivered,uint64 anchoredAt,string uri))']);
const gwAbi = parseAbi(['function totalBalance(address token,address depositor) view returns (uint256)']);
const types = { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`); };

// 1
let sigOk = 0;
for (const r of paid) {
  const a = r.authorization;
  const ok = getAddress(a.from) === buyer && await verifyTypedData({ address: buyer, domain: { name: 'GatewayWalletBatched', version: '1', chainId: 5042, verifyingContract: getAddress(r.verifyingContract) },
    types, primaryType: 'TransferWithAuthorization', message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) }, signature: r.signature });
  if (ok) sigOk++;
}
check('payment authorizations signed by the buyer', sigOk === paid.length, `${sigOk}/${paid.length}`);

// 2
const onchain = await arc.readContract({ address: round.ledger, abi: ledgerAbi, functionName: 'roundOf', args: [BigInt(round.round)] });
check('Merkle root matches DeliveryLedger on Arc', onchain.root.toLowerCase() === round.root.toLowerCase() && onchain.purchases === paid.length,
  `ledger ${round.ledger} round ${round.round}`);
const proofOk = paid.filter((r) => leafOf(r) === r.leaf && verifyProof(r.leaf, r.proof, onchain.root)).length;
check('every record proves into the on-chain root', proofOk === paid.length, `${proofOk}/${paid.length}`);

// 3
const byTx = new Map(); let settled = 0; const pending = [];
for (const r of paid) {
  const q = await fetch(`${GATEWAY_API}/x402/transfers?network=eip155:5042&nonce=${r.authorization.nonce}`).then((x) => x.json()).catch(() => ({}));
  const t = (q.transfers ?? []).find((x) => x.nonce?.toLowerCase() === r.authorization.nonce.toLowerCase());
  if (t?.txHash && ['confirmed', 'completed'].includes(t.status)) {
    settled++;
    byTx.set(t.txHash, (byTx.get(t.txHash) ?? 0n) + BigInt(r.authorization.value));
  } else pending.push(`${r.index}:${t?.status ?? 'unknown'}`);
}
check('Circle Gateway settled every authorization on Arc', settled === paid.length, `${settled}/${paid.length} settled in ${byTx.size} batch tx${pending.length ? `; not yet: ${pending.slice(0, 5).join(', ')}` : ''}`);

// 4
let debitOk = 0;
for (const [tx, sum] of byTx) {
  const rc = await arc.getTransactionReceipt({ hash: tx });
  const [before, after] = await Promise.all([rc.blockNumber - 1n, rc.blockNumber].map((b) =>
    arc.readContract({ address: rc.to, abi: gwAbi, functionName: 'totalBalance', args: [USDC, buyer], blockNumber: b })));
  const ok = before - after === sum;
  if (ok) debitOk++;
  else console.log(`     tx ${tx}: debit ${before - after} vs authorizations ${sum}`);
}
check("buyer's Gateway debit equals its authorizations in each batch", byTx.size > 0 && debitOk === byTx.size, `${debitOk}/${byTx.size} batch tx`);

// 5
const delivered = paid.filter((r) => r.delivered).length;
check('delivered count matches the on-chain count', delivered === onchain.delivered, `${delivered}/${paid.length} delivered`);
const stageCounts = Object.fromEntries(STAGES.map((s) => [s, paid.reduce((m, r) => ((m[r.stages?.[s] ?? 'none'] = (m[r.stages?.[s] ?? 'none'] ?? 0) + 1), m), {})]));
console.log('stages', JSON.stringify(stageCounts));
process.exit(results.every((r) => r.ok) ? 0 : 1);
