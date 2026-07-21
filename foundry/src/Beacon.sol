// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;

/// robinhood-toolkit · Beacon
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: All Rights Reserved (c) 2026 nirholas
///
/// Minimal deploy target used to exercise the Foundry pipeline end to end:
/// broadcast a transaction, write a run artifact, and verify source on the
/// chain's Blockscout explorer. It records who deployed it, when, and a short
/// free-form note, then lets the deployer update that note.
contract Beacon {
    /// @notice Address that deployed this Beacon.
    address public immutable deployer;

    /// @notice Block timestamp captured at construction.
    uint256 public immutable deployedAt;

    /// @notice Chain ID captured at construction (Robinhood Chain: 4663 / 46630).
    uint256 public immutable deployedChainId;

    /// @notice Free-form note, set at construction and updatable by the deployer.
    string public note;

    event NoteUpdated(address indexed by, string note);

    error NotDeployer(address caller);

    constructor(string memory note_) {
        deployer = msg.sender;
        deployedAt = block.timestamp;
        deployedChainId = block.chainid;
        note = note_;
        emit NoteUpdated(msg.sender, note_);
    }

    /// @notice Replace the note. Restricted to the original deployer.
    function setNote(string calldata note_) external {
        if (msg.sender != deployer) revert NotDeployer(msg.sender);
        note = note_;
        emit NoteUpdated(msg.sender, note_);
    }
}
