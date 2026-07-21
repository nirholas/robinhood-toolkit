#!/usr/bin/env bash
# robinhood-toolkit · reject hardcoded token addresses
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
#
# Stock Token addresses must be resolved from the live registry at runtime, never
# pasted into source. This fails the build when a 20-byte hex literal appears in
# the token-resolution paths (clients/, registry/) outside an allowlist of
# verified infrastructure addresses that legitimately live in code:
#   USDG       0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
#   WETH       0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
#   Multicall3 0xcA11bde05977b3631167028862bE2a173976CA11
#   zero       0x0000000000000000000000000000000000000000
#
# SOURCE.md is markdown and intentionally not scanned: it documents unverified
# third-party candidate addresses as evidence, clearly labelled do-not-hardcode.
set -euo pipefail

ALLOW='0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168|0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73|0xcA11bde05977b3631167028862bE2a173976CA11|0x0{40}'

hits=$(grep -rnoiE '0x[0-9a-f]{40}' --include='*.mjs' --include='*.js' --include='*.ts' clients registry 2>/dev/null \
  | grep -viE "$ALLOW" || true)

if [ -n "$hits" ]; then
  echo "hardcoded address found, resolve it from the registry instead:" >&2
  echo "$hits" >&2
  exit 1
fi
echo "check:addresses ok — no hardcoded token addresses in clients/ or registry/"
