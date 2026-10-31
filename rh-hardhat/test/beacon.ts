/* built by nirholas x.com/nichxbt */
/**
 * robinhood-toolkit · Beacon tests, run on Hardhat's in-process simulated
 * network. No RPC, no key and no signing against a real chain is involved.
 */
import { expect } from "chai";
import { network } from "hardhat";

describe("Beacon", () => {
  it("stores the constructor note and the deployer", async () => {
    const { ethers } = await network.connect();
    const [deployer] = await ethers.getSigners();
    const beacon = await ethers.deployContract("Beacon", ["robinhood-toolkit"]);

    expect(await beacon.note()).to.equal("robinhood-toolkit");
    expect(await beacon.deployer()).to.equal(deployer.address);
    expect(await beacon.pings()).to.equal(0n);
  });

  it("counts pings and emits Pinged with the caller and running count", async () => {
    const { ethers } = await network.connect();
    const [, caller] = await ethers.getSigners();
    const beacon = await ethers.deployContract("Beacon", ["n"]);

    await expect(beacon.connect(caller).ping())
      .to.emit(beacon, "Pinged")
      .withArgs(caller.address, 1n, (ts: bigint) => ts > 0n);
    await beacon.connect(caller).ping();
    expect(await beacon.pings()).to.equal(2n);
  });
});
