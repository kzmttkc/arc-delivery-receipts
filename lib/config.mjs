import fs from 'node:fs';
import { http, fallback } from 'viem';

const readEnv = (file) => Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
export const env = fs.existsSync(new URL('../.env', import.meta.url)) ? readEnv(new URL('../.env', import.meta.url)) : {};
export const funderKey = () => readEnv(new URL('../../private-delivery-proof/.env', import.meta.url)).BUYER_KEY;

export const ARC = {
  chainId: 5042, network: 'eip155:5042', cctpDomain: 26,
  usdc: '0x3600000000000000000000000000000000000000', // native USDC, ERC-20 interface uses 6 decimals
  gatewayWallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
  rpc: process.env.ARC_RPC || 'https://rpc.mainnet.arc.io',
  explorer: 'https://explorer.arc.io',
};
export const BASE = {
  chainId: 8453, cctpDomain: 6,
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
  rpc: process.env.BASE_RPC || null,
};
export const baseTransport = () => BASE.rpc ? http(BASE.rpc, { timeout: 120_000 }) : fallback([http('https://base.drpc.org'), http('https://mainnet.base.org')], { retryCount: 5 });
export const arcTransport = () => http(ARC.rpc, { retryCount: 5, timeout: 60_000 });
export const GATEWAY_API = 'https://gateway-api.circle.com/v1';
export const IRIS_API = 'https://iris-api.circle.com';
