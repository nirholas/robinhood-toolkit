// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.26;
// built by nirholas x.com/nichxbt
// robinhood-toolkit · capped mintable ERC-20 with permit
// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
// License: All Rights Reserved (c) 2026 nirholas

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract ToolkitToken is ERC20, ERC20Permit, ERC20Burnable, Ownable2Step {
    uint256 public immutable cap;

    error CapExceeded(uint256 requested, uint256 remaining);
    error ZeroCap();

    constructor(string memory name_, string memory symbol_, uint256 cap_, address owner_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
        Ownable(owner_)
    {
        if (cap_ == 0) revert ZeroCap();
        cap = cap_;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        uint256 remaining = cap - totalSupply();
        if (amount > remaining) revert CapExceeded(amount, remaining);
        _mint(to, amount);
    }
}
// built by nirholas x.com/nichxbt
