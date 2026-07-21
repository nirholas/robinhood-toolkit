// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;
// built by nirholas x.com/nichxbt

import {Script, console} from "forge-std/Script.sol";
import {ToolkitToken} from "../src/ToolkitToken.sol";

/// robinhood-toolkit · ToolkitToken deployer
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: All Rights Reserved (c) 2026 nirholas
contract DeployToken is Script {
    function run() external returns (ToolkitToken token) {
        string memory name = vm.envOr("TOKEN_NAME", string("Toolkit Token"));
        string memory symbol = vm.envOr("TOKEN_SYMBOL", string("TKT"));
        uint256 cap = vm.envOr("TOKEN_CAP", uint256(1_000_000 ether));
        address owner = vm.envOr("TOKEN_OWNER", msg.sender);

        vm.startBroadcast();
        token = new ToolkitToken(name, symbol, cap, owner);
        vm.stopBroadcast();

        console.log("token  ", address(token));
        console.log("owner  ", owner);
        console.log("cap    ", cap);
        console.log("chainid", block.chainid);
    }
}
// built by nirholas x.com/nichxbt
