<!-- built by nirholas x.com/nichxbt -->
<!--
  robinhood-toolkit · fork rehearsal transcript (08-morpho-lending)
  Author: nirholas · https://github.com/nirholas/robinhood-toolkit
  License: All Rights Reserved (c) 2026 nirholas
-->

# Fork rehearsal transcript

Captured 2026-07-21 with `bash run-fork.sh` — an anvil fork of Robinhood Chain
mainnet (chain 4663) at head ~15,354,000. Direct Morpho Blue path: supply →
advance time → accrue → withdraw, all `dryRun:false`. See fork-rehearse.mjs for
why the direct path is used (the curated Vault V2s gate deposits).

```
  Connected to fork at http://127.0.0.1:8545 (chain 4663)
  Market 0xc845da65a020ddca…  util 87.83%  supply APY 2.58%
  
  Funding 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 with 1000 USDG (impersonating 0x2d4d2a025b10c09bdbd794b4fce4f7ea8c7d7bb4)
  funded balance: 1,000 USDG

  Supply (direct Morpho Blue)
  ---------------------------
  plan: supply 1,000 USDG into 0x5fc5360D… (shares pinned to 0)
  tx 0x989366922e7e321301f30b39c58fbfa8d42183ee049bc4c4ed2e710a3f2d2ab4
  position: 997205604115864 shares  ≈ 999.999999 USDG

  Advance 365 days and accrue interest
  ------------------------------------
  position now: 1,015.368378 USDG
  interest accrued: +15.368379 USDG  ✓

  Withdraw (full position)
  ------------------------
  plan: withdraw 997205604115864 shares (assets pinned to 0)
  tx 0x4b65868226f7185512d83916f0fae6ec1fa73fbeb87417e2833a23b259eeafb2
  USDG balance after withdraw: 1,015.368378 USDG

  Result
  ------
  supplied:      1,000 USDG
  withdrew back: 1,015.368378 USDG
  interest earned over 365d: +15.368378 USDG  ✓ withdraw returned principal + interest
```

**What it proves (how-to-verify #6):** supply moved 1,000 USDG into an active
USDG market; `Morpho.accrueInterest` + `evm_increaseTime` grew the position to
1,015.368378 USDG over 365 days (≈ the market's supply APY); withdrawing the full
share position returned principal + interest. `supply`/`withdraw` each pass
assets=amount with shares pinned to `0n` — exactly one of the two is zero.
<!-- built by nirholas x.com/nichxbt -->
