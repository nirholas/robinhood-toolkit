# robinhood-toolkit examples

Build on Robinhood Chain and Robinhood Crypto. Tools, runnable examples, and 64 build prompts.

## Example 1

```sh
git clone https://github.com/nirholas/robinhood-toolkit
cd robinhood-toolkit
npm install
```

## Example 2

```sh
cast chain-id --rpc-url https://rpc.mainnet.chain.robinhood.com
# 4663
```

## Example 3

```sh
curl -s https://rpc.mainnet.chain.robinhood.com \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
# {"jsonrpc":"2.0","id":1,"result":"0x1237"}
```

## Example 4

```sh
claude mcp add robinhood-chain -- npx -y robinhood-chain-mcp
```


Every snippet above is taken from the [repository documentation](https://github.com/nirholas/robinhood-toolkit#readme).
