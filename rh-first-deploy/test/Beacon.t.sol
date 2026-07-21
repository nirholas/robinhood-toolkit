// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;
// built by nirholas x.com/nichxbt

import {Test} from "forge-std/Test.sol";
import {Beacon} from "../src/Beacon.sol";

contract BeaconTest is Test {
    Beacon internal beacon;

    function setUp() public {
        beacon = new Beacon("robinhood-toolkit first deploy");
    }

    function test_ConstructorState() public view {
        assertEq(beacon.note(), "robinhood-toolkit first deploy");
        assertEq(beacon.deployer(), address(this));
        assertEq(beacon.deployedAtBlock(), block.number);
        assertEq(beacon.pings(), 0);
    }

    function test_PingIncrements() public {
        assertEq(beacon.ping(), 1);
        assertEq(beacon.ping(), 2);
        assertEq(beacon.pings(), 2);
    }

    function test_PingEmitsEvent() public {
        vm.expectEmit(true, false, false, true, address(beacon));
        emit Beacon.Pinged(address(this), 1, block.timestamp);
        beacon.ping();
    }
}
// built by nirholas x.com/nichxbt
