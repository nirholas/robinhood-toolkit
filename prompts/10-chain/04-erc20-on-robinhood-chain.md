<!--
  robinhood-toolkit · build prompt: ERC-20 deploy on Robinhood Chain
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# 04 · Ship an ERC-20 on Robinhood Chain

## Goal

Deploy a production-shaped ERC-20 (OpenZeppelin base, permit support, capped
supply, no owner backdoor on balances), verify it on Blockscout, and drive it
from both `cast` and a viem script. End state: a verified token contract on
testnet with tests covering transfer, approve, permit, and cap enforcement.

This is your own token. It has nothing to do with Robinhood Stock Tokens, which
are issued by Robinhood Assets (Jersey) Limited and are covered in prompt 05.

## Prerequisites

- Prompt 02 completed. `rh_testnet` and `rh_mainnet` RPC aliases resolve, and
  `[etherscan]` verification entries exist in `foundry.toml`.
- A funded testnet EOA imported as a Foundry keystore account.
- Node.js 20 plus `viem` for the client-side section.

## Reference facts (verified)

- Testnet: chain ID `46630`, RPC `https://rpc.testnet.chain.robinhood.com`,
  explorer `https://explorer.testnet.chain.robinhood.com` (Blockscout).
- Mainnet: chain ID `4663`, RPC `https://rpc.mainnet.chain.robinhood.com`,
  explorer `https://robinhoodchain.blockscout.com` (Blockscout).
- Arbitrum Orbit (Nitro), fully EVM compatible. Solidity deploys unmodified and
  standard ERC-20 libraries work without changes. Deployment is permissionless.
- Gas token is ETH, around 0.055 gwei. Around 101 ms blocks.
- Canonical tokens with confirmed on-chain bytecode, both proxies:
  WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`,
  USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`.
- Docs: <https://docs.robinhood.com/chain/contracts/>.

## Steps

### 1. Install OpenZeppelin

```sh
forge install OpenZeppelin/openzeppelin-contracts
echo '@openzeppelin/=lib/openzeppelin-contracts/' >> remappings.txt
forge build
```

### 2. The token

`src/ToolkitToken.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// robinhood-toolkit · capped mintable ERC-20 with permit
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: All Rights Reserved (c) 2026 nirholas
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
```

Design notes worth keeping: the owner can mint up to the cap and nothing else.
There is no `pause`, no blocklist, and no ability to move another holder's
balance. `Ownable2Step` means an ownership transfer requires the new owner to
accept, which prevents handing the token to a typo.

### 3. Tests

`test/ToolkitToken.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ToolkitToken} from "../src/ToolkitToken.sol";

/// robinhood-toolkit · ToolkitToken tests
/// Author: nirholas · https://github.com/nirholas/robinhood-toolkit
/// License: All Rights Reserved (c) 2026 nirholas
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
```

```sh
forge test -vv
```

All tests must pass before you spend gas.

### 4. Deploy script

`script/DeployToken.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

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
```

```sh
source .env
forge script script/DeployToken.s.sol:DeployToken \
  --rpc-url rh_testnet --account "$RH_ACCOUNT" \
  --sender "$(cast wallet address --account "$RH_ACCOUNT")" \
  --broadcast --verify --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/ -vvv

export TKT=$(jq -r '[.transactions[] | select(.transactionType=="CREATE")][0].contractAddress' \
  broadcast/DeployToken.s.sol/46630/run-latest.json)
echo "$TKT"
```

### 5. Drive it from cast

```sh
ME=$(cast wallet address --account "$RH_ACCOUNT")

cast call "$TKT" 'name()(string)'      --rpc-url rh_testnet
cast call "$TKT" 'decimals()(uint8)'   --rpc-url rh_testnet
cast call "$TKT" 'cap()(uint256)'      --rpc-url rh_testnet

cast send "$TKT" 'mint(address,uint256)' "$ME" "$(cast to-wei 1000)" \
  --rpc-url rh_testnet --account "$RH_ACCOUNT"

cast call "$TKT" 'balanceOf(address)(uint256)' "$ME" --rpc-url rh_testnet

cast send "$TKT" 'transfer(address,uint256)' 0x000000000000000000000000000000000000dEaD "$(cast to-wei 1)" \
  --rpc-url rh_testnet --account "$RH_ACCOUNT"
```

### 6. Read it with viem

`clients/token.mjs`:

```js
/**
 * robinhood-toolkit · ERC-20 reader on Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: All Rights Reserved (c) 2026 nirholas
 */
import { createPublicClient, defineChain, http, erc20Abi, formatUnits, getAddress } from "viem";

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export async function readToken(client, tokenAddress, holder) {
  const token = getAddress(tokenAddress);
  const contract = { address: token, abi: erc20Abi };

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    client.readContract({ ...contract, functionName: "name" }),
    client.readContract({ ...contract, functionName: "symbol" }),
    client.readContract({ ...contract, functionName: "decimals" }),
    client.readContract({ ...contract, functionName: "totalSupply" }),
  ]);

  const balance = holder
    ? await client.readContract({ ...contract, functionName: "balanceOf", args: [getAddress(holder)] })
    : 0n;

  return {
    address: token,
    name,
    symbol,
    decimals,
    totalSupply: formatUnits(totalSupply, decimals),
    balance: formatUnits(balance, decimals),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , tokenArg, holderArg] = process.argv;
  if (!tokenArg) {
    console.error("usage: node clients/token.mjs <tokenAddress> [holderAddress]");
    process.exit(1);
  }
  const client = createPublicClient({ chain: robinhoodTestnet, transport: http() });
  console.log(await readToken(client, tokenArg, holderArg));
}
```

```sh
npm i viem
node clients/token.mjs "$TKT" "$ME"
```

The same module reads the canonical mainnet tokens. Swap the chain and pass an
address to confirm the reader works against contracts you did not deploy:

```sh
node -e '
import("./clients/token.mjs").then(async (m) => {
  const { createPublicClient, http } = await import("viem");
  const c = createPublicClient({ chain: m.robinhoodMainnet, transport: http() });
  console.log(await m.readToken(c, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"));
  console.log(await m.readToken(c, "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"));
});'
```

### 7. Mainnet

Rerun step 4 with `--rpc-url rh_mainnet` and the mainnet verifier URL. Set
`TOKEN_OWNER` to a multisig, not an EOA, for anything holding real value.

## Deliverable

- `src/ToolkitToken.sol` and `test/ToolkitToken.t.sol` with all tests passing.
- `script/DeployToken.s.sol` plus the broadcast record under
  `broadcast/DeployToken.s.sol/46630/`.
- `clients/token.mjs` exporting both chain definitions and `readToken`.
- `TOKEN.md` recording the verified address, chain ID, cap, owner, explorer link,
  and the exact constructor args used for verification.

## How to verify

1. `forge test -vv` passes, including the cap revert and the permit test.
2. `cast code "$TKT" --rpc-url rh_testnet` returns non-empty bytecode.
3. Explorer address page shows verified source and a populated Token tab with
   name, symbol, and supply.
4. `node clients/token.mjs "$TKT" "$ME"` prints the balance you minted.
5. The mainnet read in step 6 returns real metadata for USDG and WETH, which
   proves your reader works against contracts you did not deploy.
6. A non-owner mint reverts on chain, not just in tests:
   `cast send "$TKT" 'mint(address,uint256)' "$ME" 1 --rpc-url rh_testnet --account some-other-account`
   fails.

## Gotchas

- Do not assume 18 decimals when reading tokens you did not deploy. Your token is
  18 because OpenZeppelin defaults there. USDG and WETH must be read at runtime
  with `decimals()`. Hardcoding a divisor is the most common way to be off by
  10^12.
- USDG and WETH are proxies. Read them through the proxy address. The
  implementation address behind a proxy can change, so never cache it.
- `Ownable2Step` requires `acceptOwnership()` from the new owner. A transfer that
  is never accepted leaves the old owner in control, which looks like a
  successful handoff in the tx list but is not one.
- `ERC20Permit` binds the EIP-712 domain to the name and chain ID at deploy time.
  A token deployed on 46630 has a different domain separator than the same code
  on 4663. Signatures do not port between them.
- Verification needs the exact constructor args. Read them from the broadcast
  JSON, not from memory.
- Gas is around 0.055 gwei, so a deploy costs very little, which makes it easy to
  deploy carelessly. Testnet first, every time.
- Around 101 ms blocks means a receipt may arrive before a public RPC has the
  transaction indexed. Retry the read before concluding the deploy failed.
- Your ERC-20 is not a Stock Token and gives no exposure to any equity. Do not
  name or brand it in a way that implies otherwise.
