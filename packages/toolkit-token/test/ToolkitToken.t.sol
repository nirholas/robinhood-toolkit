// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ToolkitToken} from "../src/ToolkitToken.sol";

/// robinhood-toolkit · ToolkitToken tests
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: MIT (c) 2026 nirholas
contract ToolkitTokenTest is Test {
    ToolkitToken internal token;
    address internal owner = address(0xA11CE);
    address internal alice = address(0xB0B);
    uint256 internal constant CAP = 1_000_000 ether;

    function setUp() public {
        token = new ToolkitToken("Toolkit Token", "TKT", CAP, owner);
    }

    function test_MetadataAndCap() public view {
        assertEq(token.name(), "Toolkit Token");
        assertEq(token.symbol(), "TKT");
        assertEq(token.decimals(), 18);
        assertEq(token.cap(), CAP);
        assertEq(token.totalSupply(), 0);
    }

    function test_OwnerMintsAndUserTransfers() public {
        vm.prank(owner);
        token.mint(alice, 100 ether);
        assertEq(token.balanceOf(alice), 100 ether);

        vm.prank(alice);
        token.transfer(address(0xCAFE), 40 ether);
        assertEq(token.balanceOf(alice), 60 ether);
        assertEq(token.balanceOf(address(0xCAFE)), 40 ether);
    }

    function test_RevertWhen_NonOwnerMints() public {
        vm.prank(alice);
        vm.expectRevert();
        token.mint(alice, 1 ether);
    }

    function test_RevertWhen_CapExceeded() public {
        vm.startPrank(owner);
        token.mint(alice, CAP);
        vm.expectRevert(abi.encodeWithSelector(ToolkitToken.CapExceeded.selector, 1, 0));
        token.mint(alice, 1);
        vm.stopPrank();
    }

    function testFuzz_BurnReducesSupply(uint128 minted, uint128 burned) public {
        vm.assume(minted > 0 && minted <= CAP);
        burned = uint128(bound(burned, 0, minted));

        vm.prank(owner);
        token.mint(alice, minted);
        vm.prank(alice);
        token.burn(burned);

        assertEq(token.totalSupply(), uint256(minted) - burned);
    }

    function test_PermitSetsAllowance() public {
        uint256 pk = 0xA11CE5EED;
        address signer = vm.addr(pk);
        vm.prank(owner);
        token.mint(signer, 10 ether);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                signer,
                alice,
                5 ether,
                token.nonces(signer),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        token.permit(signer, alice, 5 ether, deadline, v, r, s);
        assertEq(token.allowance(signer, alice), 5 ether);
    }
}
