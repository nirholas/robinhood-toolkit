/**
 * robinhood-toolkit · Hardhat config for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "dotenv/config";

const RH_MAINNET_RPC =
  process.env.RH_MAINNET_RPC ?? "https://rpc.mainnet.chain.robinhood.com";
const RH_TESTNET_RPC =
  process.env.RH_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com";

const accounts = process.env.RH_DEPLOYER_KEY ? [process.env.RH_DEPLOYER_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      metadata: { bytecodeHash: "none" },
      evmVersion: "cancun",
    },
  },
  networks: {
    rhMainnet: { url: RH_MAINNET_RPC, chainId: 4663, accounts },
    rhTestnet: { url: RH_TESTNET_RPC, chainId: 46630, accounts },
  },
  etherscan: {
    // Blockscout does not validate the key, but the field must be present.
    apiKey: {
      rhMainnet: "blockscout",
      rhTestnet: "blockscout",
    },
    customChains: [
      {
        network: "rhMainnet",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com",
        },
      },
      {
        network: "rhTestnet",
        chainId: 46630,
        urls: {
          apiURL: "https://explorer.testnet.chain.robinhood.com/api",
          browserURL: "https://explorer.testnet.chain.robinhood.com",
        },
      },
    ],
  },
  sourcify: { enabled: false },
};

export default config;
