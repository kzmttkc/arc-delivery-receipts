// Compiles contracts/DeliveryLedger.sol with solc-js into build/DeliveryLedger.json (abi + bytecode).
const fs = require('fs');
const solc = require('solc');
const input = { language: 'Solidity', sources: { 'DeliveryLedger.sol': { content: fs.readFileSync('contracts/DeliveryLedger.sol', 'utf8') } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
if (out.errors?.some((e) => e.severity === 'error')) { console.error(out.errors); process.exit(1); }
const c = out.contracts['DeliveryLedger.sol'].DeliveryLedger;
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/DeliveryLedger.json', JSON.stringify({ compiler: solc.version(), abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 1));
console.log('compiled', solc.version(), (c.evm.bytecode.object.length / 2) + ' bytes');
