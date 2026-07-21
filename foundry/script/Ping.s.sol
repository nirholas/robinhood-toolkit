// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Script, console } from "forge-std/Script.sol";

/// robinhood-toolkit · network sanity check
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: MIT (c) 2026 nirholas
contract Ping is Script {
    function run() external view {
        console.log("chainid   ", block.chainid);
        console.log("blocknum  ", block.number);
        console.log("basefee   ", block.basefee);
        console.log("timestamp ", block.timestamp);
    }
}
