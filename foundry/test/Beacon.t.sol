// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;
// built by nirholas x.com/nichxbt

import { Test } from "forge-std/Test.sol";
import { Beacon } from "../src/Beacon.sol";

/// robinhood-toolkit · Beacon tests
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: All Rights Reserved (c) 2026 nirholas
contract BeaconTest is Test {
    Beacon internal beacon;
    address internal deployer = address(0xBEAC0);
    address internal stranger = address(0xBAD);

    function setUp() public {
        vm.prank(deployer);
        beacon = new Beacon("robinhood-toolkit");
    }

    function test_ConstructorRecordsDeployerAndNote() public view {
        assertEq(beacon.deployer(), deployer);
        assertEq(beacon.note(), "robinhood-toolkit");
        assertEq(beacon.deployedChainId(), block.chainid);
    }

    function test_DeployerCanUpdateNote() public {
        vm.prank(deployer);
        beacon.setNote("updated");
        assertEq(beacon.note(), "updated");
    }

    function test_StrangerCannotUpdateNote() public {
        vm.expectRevert(abi.encodeWithSelector(Beacon.NotDeployer.selector, stranger));
        vm.prank(stranger);
        beacon.setNote("nope");
    }

    function testFuzz_NoteRoundTrips(string calldata note) public {
        vm.prank(deployer);
        beacon.setNote(note);
        assertEq(beacon.note(), note);
    }
}
// built by nirholas x.com/nichxbt
