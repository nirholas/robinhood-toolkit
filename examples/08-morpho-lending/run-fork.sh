# built by nirholas x.com/nichxbt
# robinhood-toolkit · one-shot fork rehearsal runner (anvil up → rehearse → down)
# Author: nirholas · https://github.com/nirholas/robinhood-toolkit
# License: All Rights Reserved (c) 2026 nirholas
#
# Starts an anvil fork of Robinhood Chain, waits for it, runs the deposit/redeem
# rehearsal against it, and tears the fork down — all inside one process tree so
# it survives in environments that reap detached background daemons.
set -uo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")"

pkill -f "anvil --fork" 2>/dev/null || true
anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 --port 8545 >/tmp/anvil.log 2>&1 &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT

# Wait for readiness without a foreground sleep (curl retries on connrefused).
curl -s --retry 30 --retry-connrefused --retry-delay 1 -m 8 \
  -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' >/dev/null || {
    echo "anvil never became reachable"; cat /tmp/anvil.log; exit 1; }

echo "anvil up (pid $ANVIL_PID). Running rehearsal..."
echo
node fork-rehearse.mjs
STATUS=$?
echo
echo "rehearsal exit: $STATUS"
exit $STATUS
# built by nirholas x.com/nichxbt
