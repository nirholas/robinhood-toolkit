/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · Hardhat 3 config for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { configVariable, defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

const RH_MAINNET_RPC = process.env.RH_MAINNET_RPC ?? "https://rpc.mainnet.chain.robinhood.com";
const RH_TESTNET_RPC = process.env.RH_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com";

// The deployer key is read lazily from the encrypted Hardhat keystore
// (`npx hardhat keystore set RH_DEPLOYER_KEY`) or the RH_DEPLOYER_KEY env var.
// Nothing is resolved until a task actually connects to one of these networks.
const accounts = [configVariable("RH_DEPLOYER_KEY")];

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      metadata: { bytecodeHash: "none" },
      evmVersion: "cancun",
    },
  },
  networks: {
    rhMainnet: { type: "http", chainType: "generic", url: RH_MAINNET_RPC, chainId: 4663, accounts },
    rhTestnet: { type: "http", chainType: "generic", url: RH_TESTNET_RPC, chainId: 46630, accounts },
  },
  verify: {
    blockscout: { enabled: true },
    etherscan: { enabled: false, apiKey: "" },
    sourcify: { enabled: false },
  },
  chainDescriptors: {
    4663: {
      name: "Robinhood Chain",
      chainType: "generic",
      blockExplorers: {
        blockscout: {
          name: "Robinhood Chain Blockscout",
          url: "https://robinhoodchain.blockscout.com",
          apiUrl: "https://robinhoodchain.blockscout.com/api",
        },
      },
    },
    46630: {
      name: "Robinhood Chain Testnet",
      chainType: "generic",
      blockExplorers: {
        blockscout: {
          name: "Robinhood Chain Testnet Blockscout",
          url: "https://explorer.testnet.chain.robinhood.com",
          apiUrl: "https://explorer.testnet.chain.robinhood.com/api",
        },
      },
    },
  },
});
