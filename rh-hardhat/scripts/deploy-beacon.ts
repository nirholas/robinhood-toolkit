/**
 * robinhood-toolkit · Beacon deploy script
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { ethers, network } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";

const EXPECTED_CHAIN_IDS: Record<string, bigint> = {
  rhMainnet: 4663n,
  rhTestnet: 46630n,
};

async function main() {
  const net = await ethers.provider.getNetwork();
  const expected = EXPECTED_CHAIN_IDS[network.name];
  if (expected !== undefined && net.chainId !== expected) {
    throw new Error(
      `network ${network.name} expected chainId ${expected}, RPC reported ${net.chainId}`,
    );
  }

  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("deployer", signer.address, "balance", ethers.formatEther(balance), "ETH");
  if (balance === 0n) throw new Error("deployer has zero ETH, fund it before deploying");

  const note = process.env.BEACON_NOTE ?? "robinhood-toolkit";
  const beacon = await (await ethers.getContractFactory("Beacon")).deploy(note);
  await beacon.waitForDeployment();

  const address = await beacon.getAddress();
  const tx = beacon.deploymentTransaction();
  console.log("Beacon deployed at", address, "tx", tx?.hash);

  await mkdir("deployments", { recursive: true });
  await writeFile(
    `deployments/${network.name}.json`,
    JSON.stringify(
      {
        contract: "Beacon",
        address,
        chainId: net.chainId.toString(),
        txHash: tx?.hash ?? null,
        constructorArgs: [note],
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
