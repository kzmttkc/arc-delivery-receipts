// One command for the owner: shows exactly what will be sent, waits for "yes", then
//   A. bridges USDC from the Base funder wallet to the Arc buyer (CCTP + Circle Forwarding Service: no Arc gas needed)
//   B. deploys DeliveryLedger on Arc (once)
//   C. deposits into Circle Gateway on Arc
//   D. buys every listing in data/plan.json once, recording the signed authorization and the response hash
//   E. anchors the Merkle root of the round in DeliveryLedger
// Every stage is skipped when its result already exists, so an interrupted run resumes where it stopped.
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { createWalletClient, createPublicClient, publicActions, erc20Abi, parseAbi, pad, formatUnits, parseUnits, sha256, toBytes, keccak256, toHex } from 'viem';
import { base, arc as arcChain } from 'viem/chains';
import { privateKeyToAccount, nonceManager } from 'viem/accounts';
import { BatchEvmScheme, GatewayClient } from '@circle-fin/x402-batching/client';
import { env, funderKey, ARC, BASE, baseTransport, arcTransport, IRIS_API } from './lib/config.mjs';
import { checks } from './lib/judge.mjs';
import { leafFor, tree, proofOf } from './lib/merkle.mjs';

// Tests may skip the prompt only when both chains are local forks. Anything else asks a human.
const isLocal = (u) => /^http:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(u ?? '');
if (process.env.AUTO_YES === '1' && !(isLocal(process.env.ARC_RPC) && isLocal(process.env.BASE_RPC))) {
  console.error('AUTO_YES is only allowed when ARC_RPC and BASE_RPC both point to local forks.'); process.exit(1);
}
const SKIP_BUY = process.env.SKIP_BUY === '1'; // fork tests: do not contact real sellers
const ROUND = Number(process.env.ROUND ?? 1);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const BRIDGE = parseUnits(process.env.BRIDGE_USDC ?? '15', 6);
const stateDir = new URL(`./state/round-${ROUND}/`, import.meta.url);
fs.mkdirSync(new URL('records/', stateDir), { recursive: true });
fs.mkdirSync(new URL('bodies/', stateDir), { recursive: true });
const deployFile = new URL('./state/deploy.json', import.meta.url);

const PLAN = process.env.PLAN ?? 'data/plan.json';
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const LEAF_VERSION = plan.method === 'v1' ? 1 : 0;
const items = plan.items.slice(0, LIMIT);
const need = items.reduce((s, p) => s + BigInt(p.amount), 0n);

const buyer = privateKeyToAccount(env.ARC_BUYER_KEY, { nonceManager });
const funder = privateKeyToAccount(funderKey(), { nonceManager });
const arc = createWalletClient({ account: buyer, chain: arcChain, transport: arcTransport() }).extend(publicActions);
const baseW = createWalletClient({ account: funder, chain: base, transport: baseTransport() }).extend(publicActions);
const gateway = new GatewayClient({ chain: 'arc', privateKey: env.ARC_BUYER_KEY, rpcUrl: ARC.rpc });
const ledgerBuild = JSON.parse(fs.readFileSync('build/DeliveryLedger.json', 'utf8'));
const usdcArc = (a) => arc.readContract({ address: ARC.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [a] });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const recordFile = (i) => new URL(`records/${String(i + 1).padStart(3, '0')}.json`, stateDir);
const done = items.filter((_, i) => fs.existsSync(recordFile(i))).length;

// ---- what will happen ----
const [arcUsdc, gw, baseUsdc, baseEth] = await Promise.all([
  usdcArc(buyer.address), gateway.getBalances(), baseW.readContract({ address: BASE.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [funder.address] }),
  baseW.getBalance({ address: funder.address }),
]);
const deployed = fs.existsSync(deployFile) ? JSON.parse(fs.readFileSync(deployFile, 'utf8')) : null;
const remaining = items.slice(done).reduce((s, p) => s + BigInt(p.amount), 0n);
const needBridge = gw.gateway.available < remaining && arcUsdc < remaining + parseUnits('0.5', 6);
const needDeposit = gw.gateway.available < remaining;
const depositAmount = remaining - gw.gateway.available + parseUnits('0.2', 6);
const fee = needBridge ? (await (await fetch(`${IRIS_API}/v2/burn/USDC/fees/${BASE.cctpDomain}/${ARC.cctpDomain}?forward=true`)).json()).find((f) => f.finalityThreshold === 1000) : null;
const maxFee = fee ? BigInt(fee.forwardFee.high) + (BRIDGE * BigInt(Math.ceil(fee.minimumFee * 100))) / 1_000_000n + 1n : 0n;

console.log(`\nラウンド ${ROUND}（購入予定 ${items.length} 件・うち記録済み ${done} 件）`);
console.log(`Base の資金元 ${funder.address}: USDC ${formatUnits(baseUsdc, 6)} / ETH ${formatUnits(baseEth, 18)}`);
console.log(`Arc の買い手 ${buyer.address}: USDC ${formatUnits(arcUsdc, 6)} / Gateway 残高 ${gw.gateway.formattedAvailable}`);
console.log('\nこれから送るもの:');
let n = 0;
if (needBridge) console.log(`  ${++n}. Base → Arc へ USDC ${formatUnits(BRIDGE, 6)} を移す（Circle CCTP・手数料上限 ${formatUnits(maxFee, 6)} USDC）`);
if (!deployed) console.log(`  ${++n}. Arc に記録用コントラクト DeliveryLedger を置く（ガス 約 $0.02）`);
if (needDeposit) console.log(`  ${++n}. Arc の Circle Gateway に USDC ${formatUnits(depositAmount, 6)} を預ける`);
if (items.length > done) console.log(`  ${++n}. Arc の x402 出品を ${items.length - done} 件、1件ずつ買う（合計 ${formatUnits(remaining, 6)} USDC・1件 $1 以下）`);
console.log(`  ${++n}. 購入記録の Merkle 根を DeliveryLedger に記録する（ガス 約 $0.01）`);
if (process.env.AUTO_YES !== '1') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = (await rl.question('\n実行してよければ yes と入力: ')).trim();
  rl.close();
  if (ans !== 'yes') { console.log('中止しました。何も送っていません。'); process.exit(0); }
}

// ---- A. bridge ----
if (needBridge) {
  const total = BRIDGE + maxFee;
  const approve = await baseW.writeContract({ address: BASE.usdc, abi: erc20Abi, functionName: 'approve', args: [BASE.tokenMessengerV2, total] });
  await baseW.waitForTransactionReceipt({ hash: approve });
  const tmAbi = parseAbi(['function depositForBurnWithHook(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,uint256 maxFee,uint32 minFinalityThreshold,bytes hookData)']);
  for (let i = 0; i < 20 && (await baseW.readContract({ address: BASE.usdc, abi: erc20Abi, functionName: 'allowance', args: [funder.address, BASE.tokenMessengerV2] })) < total; i++) await sleep(2000);
  const burn = await baseW.writeContract({ address: BASE.tokenMessengerV2, abi: tmAbi, functionName: 'depositForBurnWithHook',
    args: [total, ARC.cctpDomain, pad(buyer.address), BASE.usdc, pad('0x00'), maxFee, 1000, '0x636374702d666f72776172640000000000000000000000000000000000000000'] });
  const r = await baseW.waitForTransactionReceipt({ hash: burn });
  if (r.status !== 'success') throw new Error(`burn failed ${burn}`);
  console.log(`  ok Base で USDC を送り出した https://basescan.org/tx/${burn}`);
  const before = arcUsdc;
  for (let i = 0; ; i++) {
    const now = await usdcArc(buyer.address);
    if (now >= before + BRIDGE - parseUnits('0.1', 6)) { console.log(`  ok Arc に届いた（USDC ${formatUnits(now, 6)}）`); break; }
    if (i > 180) throw new Error('Arc への着金が 30 分以内に確認できない。もう一度同じコマンドを打つと続きから再開します');
    await sleep(10000);
  }
}

// ---- B. deploy ledger ----
let ledger = deployed?.ledger;
if (!ledger) {
  const hash = await arc.deployContract({ abi: ledgerBuild.abi, bytecode: ledgerBuild.bytecode, args: [buyer.address] });
  const r = await arc.waitForTransactionReceipt({ hash });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`deploy failed ${hash}`);
  ledger = r.contractAddress;
  fs.writeFileSync(deployFile, JSON.stringify({ ledger, deployTx: hash, recorder: buyer.address, chainId: ARC.chainId, compiler: ledgerBuild.compiler }, null, 1));
  console.log(`  ok DeliveryLedger ${ARC.explorer}/address/${ledger}`);
}

// ---- C. deposit ----
if (needDeposit) {
  const d = await gateway.deposit(formatUnits(depositAmount, 6));
  console.log(`  ok Gateway へ預けた ${ARC.explorer}/tx/${d.depositTxHash}`);
  for (let i = 0; i < 60 && (await gateway.getBalances()).gateway.available < remaining; i++) await sleep(2000);
}

// ---- D. buy ----
const scheme = new BatchEvmScheme(buyer);
for (let i = done; i < (SKIP_BUY ? done : items.length); i++) {
  const p = items[i];
  const url = new URL(p.resource);
  if (p.request.query) for (const [k, v] of Object.entries(p.request.query)) url.searchParams.set(k, String(v));
  const body = p.method === 'POST' ? JSON.stringify(p.request.body ?? {}) : undefined;
  const init = { method: p.method, headers: { 'content-type': 'application/json' }, body };
  const rec = { round: ROUND, index: i + 1, resource: p.resource, host: p.host, method: p.method, requestKind: p.request.kind,
    resourceHash: keccak256(toBytes(p.resource)), requestHash: sha256(toBytes(`${p.method} ${url.toString()}\n${body ?? ''}`)), startedAt: new Date().toISOString() };
  try {
    const r402 = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
    const h = r402.headers.get('PAYMENT-REQUIRED');
    const pr = r402.status === 402 && h ? JSON.parse(Buffer.from(h, 'base64').toString()) : null;
    const opt = pr?.accepts?.find((a) => a.network === ARC.network && a.extra?.name === 'GatewayWalletBatched' && a.extra?.version === '1');
    if (!opt) { rec.outcome = 'not_bought'; rec.reason = `no Gateway 402 now (HTTP ${r402.status})`; }
    else if (BigInt(opt.amount) > BigInt(p.amount) || opt.payTo.toLowerCase() !== p.payTo.toLowerCase()) { rec.outcome = 'not_bought'; rec.reason = 'price or payTo changed since the plan'; }
    else {
      const payload = await scheme.createPaymentPayload(pr.x402Version ?? 2, opt);
      rec.authorization = payload.payload.authorization;
      rec.signature = payload.payload.signature;
      rec.verifyingContract = opt.extra.verifyingContract;
      const header = Buffer.from(JSON.stringify({ ...payload, resource: pr.resource, accepted: opt })).toString('base64');
      let res, bytes = Buffer.alloc(0);
      try {
        res = await fetch(url, { ...init, headers: { ...init.headers, 'Payment-Signature': header }, signal: AbortSignal.timeout(90000) });
        bytes = Buffer.from(await res.arrayBuffer());
      } catch (e) { rec.fetchError = String(e.name === 'TimeoutError' ? 'timeout' : e.message).slice(0, 200); }
      rec.status = res?.status ?? 0;
      rec.contentType = res?.headers.get('content-type') ?? null;
      rec.responseBytes = bytes.length;
      rec.responseHash = sha256(bytes);
      const pRes = res?.headers.get('PAYMENT-RESPONSE');
      rec.settlement = pRes ? JSON.parse(Buffer.from(pRes, 'base64').toString()) : null;
      rec.leafVersion = LEAF_VERSION;
      Object.assign(rec, checks({ status: rec.status, contentType: rec.contentType, bytes, declaredMime: p.mimeType, outputSchema: p.outputSchema }));
      rec.outcome = rec.passed ? 'passed_checks' : 'failed_checks';
      if (LEAF_VERSION === 0) rec.delivered = rec.passed;
      fs.writeFileSync(new URL(`bodies/${String(i + 1).padStart(3, '0')}.bin`, stateDir), bytes);
    }
  } catch (e) { rec.outcome = 'not_bought'; rec.reason = String(e.message).slice(0, 200); }
  rec.finishedAt = new Date().toISOString();
  fs.writeFileSync(recordFile(i), JSON.stringify(rec, null, 1));
  console.log(`  ${i + 1}/${items.length} ${rec.outcome}${rec.status ? ` ${rec.status}` : ''} ${p.host}${new URL(p.resource).pathname.slice(0, 50)}`);
  await sleep(700);
}

// ---- E. anchor ----
const records = items.map((_, i) => JSON.parse(fs.readFileSync(recordFile(i), 'utf8')));
if (!records.some((r) => r.authorization)) { console.log('支払った購入が 0 件なので記録はしません。'); process.exit(0); }
const paid = records.filter((r) => r.authorization);
const leaves = paid.map((r) => leafFor(r));
const { root, layers } = tree(leaves);
paid.forEach((r, k) => { r.leaf = leaves[k]; r.proof = proofOf(layers, k); });
const outDir = new URL(`./public/rounds/${ROUND}/`, import.meta.url);
fs.mkdirSync(outDir, { recursive: true });
const summary = { round: ROUND, method: plan.method ?? 'v0', root, purchases: paid.length, delivered: paid.filter((r) => r.passed ?? r.delivered).length, notBought: records.length - paid.length, ledger };
const uri = `rounds/${ROUND}/records.json`;
const existing = await arc.readContract({ address: ledger, abi: ledgerBuild.abi, functionName: 'rounds' });
let anchorTx = null;
if (existing < BigInt(ROUND)) {
  anchorTx = await arc.writeContract({ address: ledger, abi: ledgerBuild.abi, functionName: 'anchor', args: [root, summary.purchases, summary.delivered, uri] });
  await arc.waitForTransactionReceipt({ hash: anchorTx });
  console.log(`  ok 記録した ${ARC.explorer}/tx/${anchorTx}`);
}
fs.writeFileSync(new URL('records.json', outDir), JSON.stringify({ ...summary, anchorTx, records }, null, 1));
console.log(`\n完了: 支払い ${summary.purchases} 件・検査を通った応答 ${summary.delivered} 件・買わなかった ${summary.notBought} 件。Merkle 根 ${root}`);
