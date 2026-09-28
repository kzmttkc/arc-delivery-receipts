// Local forks for tests. Nothing here touches a real chain.
const fork = process.env.FORK === 'base'
  ? { chainId: 8453, url: process.env.FORK_URL || 'https://base.drpc.org' }
  : { chainId: 5042, url: process.env.FORK_URL || 'https://rpc.mainnet.arc.io' };
module.exports = {
  networks: { hardhat: { chainId: fork.chainId, hardfork: 'cancun', forking: { url: fork.url }, chains: { [fork.chainId]: { hardforkHistory: { cancun: 0 } } } } },
};
