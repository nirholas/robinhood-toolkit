// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;
// built by nirholas x.com/nichxbt

import { Script, console } from "forge-std/Script.sol";

/// robinhood-toolkit · network sanity check
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: All Rights Reserved (c) 2026 nirholas
contract Ping is Script {
    function run() external view {
        console.log("chainid   ", block.chainid);
        console.log("blocknum  ", block.number);
        console.log("basefee   ", block.basefee);
        console.log("timestamp ", block.timestamp);
    }
}
// built by nirholas x.com/nichxbt
