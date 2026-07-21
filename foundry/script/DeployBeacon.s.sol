// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";
import { Beacon } from "../src/Beacon.sol";

/// robinhood-toolkit · Beacon deployer
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: MIT (c) 2026 nirholas
contract DeployBeacon is Script {
    function run() external returns (Beacon beacon) {
        string memory note = vm.envOr("BEACON_NOTE", string("robinhood-toolkit"));

        vm.startBroadcast();
        beacon = new Beacon(note);
        vm.stopBroadcast();

        console.log("Beacon deployed:", address(beacon));
        console.log("chainid:", block.chainid);
    }
}
