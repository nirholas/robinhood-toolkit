// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// robinhood-toolkit · minimal deploy target
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: MIT (c) 2026 nirholas
contract Beacon {
    string public note;
    address public immutable deployer;
    uint256 public pings;

    event Pinged(address indexed from, uint256 count, uint256 timestamp);

    constructor(string memory note_) {
        note = note_;
        deployer = msg.sender;
    }

    function ping() external returns (uint256) {
        pings += 1;
        emit Pinged(msg.sender, pings, block.timestamp);
        return pings;
    }
}
