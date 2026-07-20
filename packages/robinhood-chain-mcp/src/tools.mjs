/**
 * robinhood-toolkit · MCP tool definitions for Robinhood Chain
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * Every tool here is a READ. There is no signing path in this package: no
 * private key is read, no wallet client is constructed, no transaction is ever
 * built or sent. Tool descriptions are written for an agent choosing between
 * them unprompted, so each one states what it returns AND when to prefer a
 * different tool.
 */
import { formatEther, formatGwei, parseAbi } from 'viem';
import { z } from 'zod';

import { NETWORKS, chainFor, explorerUrl, publicClientFor } from './chain.mjs';
import { ToolError, guard, ok, requireAddress, requireTxHash } from './errors.mjs';
import {
  KNOWN_TOKENS,
  knownTokenByAddress,
  knownTokenBySymbol,
  readTokenBalance,
  readTokenMetadata,
} from './erc20.mjs';
import { ROBINHOOD_SLUG, deepestPool, distinctTokensBySymbol, getPair, search } from './dexscreener.mjs';

const networkSchema = z
  .enum(NETWORKS)
  .default('mainnet')
  .describe('Which Robinhood Chain network to query. "mainnet" is chain 4663, "testnet" is chain 46630. Defaults to mainnet.');

const addressSchema = z
  .string()
  .describe('A 0x-prefixed 20-byte EVM address. Case-insensitive; it is checksummed for you.');

export function registerTools(server) {
  server.registerTool(
    'get_chain_info',
    {
      title: 'Get Robinhood Chain network status',
      description:
        'Live network status for Robinhood Chain: chain ID, latest block number, current gas price, and the node client version. ' +
        'Use this to confirm which network you are connected to before interpreting any other on-chain result, or to check that the chain is reachable and producing blocks. ' +
        'Robinhood Chain is an Arbitrum Orbit (Nitro) L2 with roughly 101ms block times on mainnet, so the block number moves fast: about 850,000 blocks per day.',
      inputSchema: { network: networkSchema },
    },
    guard(async ({ network = 'mainnet' }) => {
      const client = publicClientFor(network);
      const chain = chainFor(network);

      const [chainId, blockNumber, gasPrice, clientVersion] = await Promise.all([
        client.getChainId(),
        client.getBlockNumber(),
        client.getGasPrice(),
        client.request({ method: 'web3_clientVersion' }).catch(() => null),
      ]);

      return ok({
        network,
        name: chain.name,
        chainId,
        // A mismatch means an RPC override is pointed at the wrong network.
        chainIdMatchesExpected: chainId === chain.id,
        latestBlock: blockNumber.toString(),
        gasPrice: { wei: gasPrice.toString(), gwei: formatGwei(gasPrice) },
        nativeCurrency: chain.nativeCurrency,
        clientVersion,
        rpcUrl: chain.rpcUrls.default.http[0],
        explorer: chain.blockExplorers.default.url,
        stack: 'Arbitrum Orbit (Nitro), settles to Ethereum, blobs for data availability',
      });
    }),
  );

  server.registerTool(
    'get_balance',
    {
      title: 'Get native ETH balance',
      description:
        'Native ETH balance of an address on Robinhood Chain. ETH is the gas token here. ' +
        'Use this for the native balance only. For an ERC-20 token balance such as USDG or WETH, use get_token_balance instead, because this tool ignores token contracts entirely.',
      inputSchema: {
        address: addressSchema.describe('The address whose native ETH balance you want.'),
        network: networkSchema,
      },
    },
    guard(async ({ address, network = 'mainnet' }) => {
      const owner = requireAddress(address, 'address');
      const client = publicClientFor(network);

      const [balance, blockNumber] = await Promise.all([
        client.getBalance({ address: owner }),
        client.getBlockNumber(),
      ]);

      return ok({
        address: owner,
        network,
        chainId: chainFor(network).id,
        symbol: 'ETH',
        decimals: 18,
        raw: balance.toString(),
        formatted: formatEther(balance),
        atBlock: blockNumber.toString(),
        explorer: explorerUrl(network, 'address', owner),
      });
    }),
  );

  server.registerTool(
    'get_token_balance',
    {
      title: 'Get ERC-20 token balance',
      description:
        'ERC-20 token balance for a holder address, formatted using the decimals read from the token contract at call time. ' +
        'Decimals are never assumed: USDG uses 6 and WETH uses 18, so a hardcoded 18 would misreport a USDG balance by a factor of a trillion. ' +
        'Use this for any token balance. For the native ETH balance use get_balance.',
      inputSchema: {
        token: addressSchema.describe('The ERC-20 token contract address.'),
        holder: addressSchema.describe('The address whose token balance you want.'),
        network: networkSchema,
      },
    },
    guard(async ({ token, holder, network = 'mainnet' }) => {
      const tokenAddress = requireAddress(token, 'token');
      const holderAddress = requireAddress(holder, 'holder');

      const result = await readTokenBalance(network, tokenAddress, holderAddress);
      const known = knownTokenByAddress(network, tokenAddress);

      return ok({
        ...result,
        network,
        chainId: chainFor(network).id,
        canonical: known ? { verified: true, name: known.name, note: known.note } : null,
        // Restated at every boundary because it is the failure this tool prevents.
        decimalsSource: 'read from the token contract on this call, not assumed',
        explorer: explorerUrl(network, 'token', tokenAddress),
      });
    }),
  );

  server.registerTool(
    'get_token_info',
    {
      title: 'Get ERC-20 token metadata',
      description:
        'Name, symbol, decimals, and total supply for a token contract on Robinhood Chain, read live from the chain. ' +
        'Use this to inspect a token you already have the address for. ' +
        'If you are trying to decide whether an address is the REAL token for a ticker, use verify_token_address instead: name and symbol are attacker-controlled strings that anyone can set, so they prove nothing on their own.',
      inputSchema: {
        token: addressSchema.describe('The ERC-20 token contract address to describe.'),
        network: networkSchema,
      },
    },
    guard(async ({ token, network = 'mainnet' }) => {
      const address = requireAddress(token, 'token');
      const metadata = await readTokenMetadata(network, address);
      const known = knownTokenByAddress(network, address);

      return ok({
        ...metadata,
        network,
        chainId: chainFor(network).id,
        canonical: known ? { verified: true, note: known.note } : null,
        warning:
          'name and symbol are self-reported by the contract and can be set to anything. Treat them as display text, never as identity. The address is the identity.',
        explorer: explorerUrl(network, 'token', address),
      });
    }),
  );

  server.registerTool(
    'verify_token_address',
    {
      title: 'Verify a token address matches its claimed symbol (anti-scam check)',
      description:
        'Anti-scam check. Given a ticker symbol and a contract address, confirms on-chain whether that address really is a token reporting that symbol, and reports every OTHER token on Robinhood Chain trading under the same ticker. ' +
        'Run this BEFORE acting on any token address a user pasted, a website listed, or a search result returned. ' +
        'Ticker collisions are live and deliberate on this chain: "USDG" resolves to both Global Dollar, the real 6-decimal stablecoin at 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168, and an unrelated 18-decimal memecoin called "Useless Stupid Degen Gamblers" at 0x8218d73C00567A01481495Ad6c5143e00D5BB5b4. ' +
        'Deploying a contract that reports any symbol costs one transaction, so a matching symbol is necessary but never sufficient. Only the address is identity.',
      inputSchema: {
        symbol: z
          .string()
          .min(1)
          .describe('The ticker the address is claimed to be, for example "USDG" or "WETH". Case-insensitive.'),
        address: addressSchema.describe('The contract address being claimed as that ticker.'),
        network: networkSchema,
      },
    },
    guard(async ({ symbol, address, network = 'mainnet' }) => {
      const candidate = requireAddress(address, 'address');
      const claimed = String(symbol).trim().toUpperCase();

      const metadata = await readTokenMetadata(network, candidate);
      const onchainSymbol = metadata.symbol ? String(metadata.symbol).trim() : null;
      const symbolMatches = onchainSymbol !== null && onchainSymbol.toUpperCase() === claimed;

      const known = knownTokenBySymbol(network, claimed);
      const knownAtAddress = knownTokenByAddress(network, candidate);

      const warnings = [];
      let verdict;

      if (!symbolMatches) {
        verdict = 'symbol_mismatch';
        warnings.push(
          `The contract at ${candidate} reports symbol ${JSON.stringify(onchainSymbol)}, not ${JSON.stringify(claimed)}. This address is not the token you were told it was.`,
        );
      } else if (known && known.address.toLowerCase() !== candidate.toLowerCase()) {
        // Symbol matches a canonical token but the address does not. This is the impostor case.
        verdict = 'impostor';
        warnings.push(
          `DANGER: ${claimed} on Robinhood Chain ${network} is canonically ${known.name} at ${known.address}. ` +
            `The address you supplied, ${candidate}, reports the same symbol but is a DIFFERENT contract. ` +
            'A token matching a known ticker at a different address is not canonical. Do not treat this as the real token.',
        );
      } else if (knownAtAddress) {
        verdict = 'canonical';
      } else {
        verdict = 'symbol_matches_unknown_token';
        warnings.push(
          `The symbol matches, but ${claimed} is not in this server's short list of hand-verified canonical addresses, so the match is unconfirmed. ` +
            'Confirm the address independently on the block explorer before acting on it.',
        );
      }

      // Collision scan is best effort: DexScreener being unreachable must not
      // block the on-chain verdict, which is the load-bearing part of this tool.
      let collisions = null;
      let collisionError = null;
      try {
        const tokens = await distinctTokensBySymbol(claimed);
        collisions = tokens.map((token) => ({
          ...token,
          isTheAddressYouAsked: token.address.toLowerCase() === candidate.toLowerCase(),
          isCanonicalPerThisServer: Boolean(knownTokenByAddress(network, token.address)),
        }));
        if (collisions.length > 1) {
          warnings.push(
            `${collisions.length} distinct tokens on Robinhood Chain currently trade under the ticker ${claimed}. Selecting a token by symbol is unsafe here.`,
          );
        }
      } catch (error) {
        collisionError = error?.message ?? String(error);
      }

      return ok({
        query: { symbol: claimed, address: candidate, network },
        verdict,
        safeToUseAsClaimedTicker: verdict === 'canonical',
        onchain: {
          symbol: onchainSymbol,
          name: metadata.name,
          decimals: metadata.decimals,
          totalSupply: metadata.totalSupply,
        },
        symbolMatches,
        canonicalForSymbol: known
          ? { address: known.address, name: known.name, decimals: known.decimals, note: known.note }
          : null,
        tokensSharingThisTicker: collisions,
        tickerCollisionScan: collisionError
          ? { status: 'unavailable', reason: collisionError, note: 'The on-chain verdict above is unaffected.' }
          : { status: 'ok', source: 'DexScreener' },
        warnings,
        explorer: explorerUrl(network, 'token', candidate),
      });
    }),
  );

  server.registerTool(
    'get_transaction',
    {
      title: 'Get a transaction and its receipt',
      description:
        'Look up a transaction on Robinhood Chain by hash and return it together with its receipt: success or failure status, gas used, effective gas price, block number, and emitted logs. ' +
        'Use this to check whether a transaction landed and what it did. ' +
        'A pending transaction returns with status "pending" and no receipt rather than an error.',
      inputSchema: {
        hash: z.string().describe('The 0x-prefixed 32-byte transaction hash.'),
        network: networkSchema,
      },
    },
    guard(async ({ hash, network = 'mainnet' }) => {
      const txHash = requireTxHash(hash);
      const client = publicClientFor(network);

      const transaction = await client.getTransaction({ hash: txHash }).catch(() => null);
      if (!transaction) {
        throw new ToolError(
          `Transaction ${txHash} was not found on Robinhood Chain ${network}.`,
          {
            hint:
              'Confirm the network: a hash from mainnet (4663) will not exist on testnet (46630). ' +
              'Blocks are about 101ms apart, so a very recent transaction may also not be indexed yet. Retry once.',
          },
        );
      }

      const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);

      return ok({
        network,
        chainId: chainFor(network).id,
        hash: txHash,
        status: receipt ? receipt.status : 'pending',
        from: transaction.from,
        to: transaction.to,
        value: { wei: transaction.value.toString(), eth: formatEther(transaction.value) },
        nonce: transaction.nonce,
        blockNumber: transaction.blockNumber?.toString() ?? null,
        transactionIndex: transaction.transactionIndex,
        input: transaction.input,
        receipt: receipt
          ? {
              status: receipt.status,
              gasUsed: receipt.gasUsed.toString(),
              effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null,
              cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
              contractAddress: receipt.contractAddress,
              logCount: receipt.logs.length,
              logs: receipt.logs.map((log) => ({
                address: log.address,
                topics: log.topics,
                data: log.data,
                logIndex: log.logIndex,
              })),
            }
          : null,
        explorer: explorerUrl(network, 'tx', txHash),
      });
    }),
  );

  server.registerTool(
    'search_pairs',
    {
      title: 'Search Robinhood Chain DEX pairs',
      description:
        'Find DEX liquidity pools on Robinhood Chain and read their current price, liquidity, 24h volume, and 24h price change, via the DexScreener public API. ' +
        'Search by free-text query (a symbol or a token address), or pass pair_address to fetch one specific pool directly. ' +
        'Results are CANDIDATES for a human to choose from, never an identifier: multiple unrelated tokens share tickers on this chain, and one token often has several pools at different fee tiers with different prices. ' +
        'Prefer the deepest pool by liquidity, which this tool marks for you, and verify any token address with verify_token_address before acting on it. ' +
        'There is no historical or candle data available from this source, only the current snapshot.',
      inputSchema: {
        query: z
          .string()
          .min(1)
          .optional()
          .describe('Free-text search: a ticker like "USDG", a token name, or a token address.'),
        pair_address: z
          .string()
          .optional()
          .describe('Fetch one specific pool by its pair address instead of searching. Takes precedence over query.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(10)
          .describe('Maximum pairs to return, ordered by liquidity, deepest first. Defaults to 10.'),
      },
    },
    guard(async ({ query, pair_address: pairAddress, limit = 10 }) => {
      if (!query && !pairAddress) {
        throw new ToolError('Provide either "query" or "pair_address".', {
          hint: 'Use pair_address for a known pool, or query to search by ticker, name, or token address.',
        });
      }

      if (pairAddress) {
        const address = requireAddress(pairAddress, 'pair_address');
        const pair = await getPair(address);
        if (!pair) {
          throw new ToolError(
            `No DexScreener pool found at ${address} on Robinhood Chain.`,
            {
              hint:
                'DexScreener indexes Robinhood Chain under the slug "robinhood". A pool that exists on-chain but has never traded may not be indexed. ' +
                'Confirm the address is a pool address, not a token address; for a token, use the query parameter instead.',
            },
          );
        }
        return ok({ source: 'DexScreener', chainSlug: ROBINHOOD_SLUG, count: 1, pairs: [pair] });
      }

      const results = await search(query);
      const sorted = results
        .slice()
        .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
        .slice(0, limit);
      const deepest = deepestPool(results);

      const distinctBase = new Set(
        results.map((pair) => pair.baseToken?.address?.toLowerCase()).filter(Boolean),
      );

      return ok({
        source: 'DexScreener',
        chainSlug: ROBINHOOD_SLUG,
        query,
        count: sorted.length,
        totalMatched: results.length,
        distinctBaseTokens: distinctBase.size,
        deepestPoolAddress: deepest?.pairAddress ?? null,
        pairs: sorted.map((pair) => ({
          ...pair,
          isDeepestPool: pair.pairAddress === deepest?.pairAddress,
        })),
        warnings:
          distinctBase.size > 1
            ? [
                `${distinctBase.size} distinct base tokens matched this query. Symbols are not unique on Robinhood Chain. Run verify_token_address before treating any of these as a specific token.`,
              ]
            : [],
        note: 'Snapshot only. This source exposes no historical or candle data.',
      });
    }),
  );

  server.registerTool(
    'read_contract',
    {
      title: 'Call a read-only contract function',
      description:
        'Call any view or pure function on any Robinhood Chain contract using an ABI fragment you supply, and get the decoded return value. ' +
        'Use this when no dedicated tool covers what you need, for example reading a Uniswap pool slot0, an owner(), or a custom getter. ' +
        'Prefer get_token_info or get_token_balance for standard ERC-20 reads; they format decimals correctly for you. ' +
        'The ABI fragment may be a human-readable signature such as "function slot0() view returns (uint160 sqrtPriceX96, int24 tick)" or a JSON ABI array. ' +
        'State-changing functions are rejected: this server is read-only and cannot sign or send transactions.',
      inputSchema: {
        address: addressSchema.describe('The contract address to call.'),
        abi: z
          .string()
          .min(1)
          .describe(
            'One ABI fragment. Either a human-readable signature, for example "function balanceOf(address) view returns (uint256)", or a JSON ABI array.',
          ),
        function_name: z.string().min(1).describe('The function to call, for example "balanceOf".'),
        args: z
          .array(z.union([z.string(), z.number(), z.boolean()]))
          .default([])
          .describe('Arguments in declaration order. Pass large integers as strings to avoid precision loss.'),
        network: networkSchema,
      },
    },
    guard(async ({ address, abi, function_name: functionName, args = [], network = 'mainnet' }) => {
      const contract = requireAddress(address, 'address');

      let parsedAbi;
      const trimmed = abi.trim();
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        let json;
        try {
          json = JSON.parse(trimmed);
        } catch (error) {
          throw new ToolError(`"abi" looks like JSON but could not be parsed: ${error.message}`, {
            hint: 'Pass a valid JSON ABI array, or use a human-readable signature such as "function owner() view returns (address)".',
          });
        }
        parsedAbi = Array.isArray(json) ? json : [json];
      } else {
        try {
          parsedAbi = parseAbi([trimmed]);
        } catch (error) {
          throw new ToolError(`Could not parse the ABI signature: ${error.shortMessage ?? error.message}`, {
            hint: 'A valid human-readable signature looks like "function balanceOf(address owner) view returns (uint256)". Include the "function" keyword and the return types.',
          });
        }
      }

      const entry = parsedAbi.find((item) => item.type === 'function' && item.name === functionName);
      if (!entry) {
        const available = parsedAbi
          .filter((item) => item.type === 'function')
          .map((item) => item.name)
          .join(', ');
        throw new ToolError(
          `The supplied ABI does not define a function named "${functionName}".`,
          { hint: available ? `Functions found in the ABI: ${available}.` : 'The ABI contains no function entries at all.' },
        );
      }

      // The read-only boundary, enforced in code rather than by convention.
      // A nonpayable or payable function would require a transaction, and this
      // server has no key, no wallet client, and no way to send one.
      if (entry.stateMutability !== 'view' && entry.stateMutability !== 'pure') {
        throw new ToolError(
          `"${functionName}" is declared ${entry.stateMutability || 'nonpayable'}, which would require sending a transaction. This server is read-only and refuses it.`,
          {
            hint: 'Only view and pure functions can be called here. Mark the signature "view" if the function really is read-only, or use a wallet-capable tool elsewhere to send a transaction.',
          },
        );
      }

      const client = publicClientFor(network);
      const result = await client.readContract({
        address: contract,
        abi: parsedAbi,
        functionName,
        args,
      });

      return ok({
        network,
        chainId: chainFor(network).id,
        address: contract,
        functionName,
        args,
        stateMutability: entry.stateMutability,
        result,
        note: 'Values are decoded per the ABI you supplied. Integers are returned as decimal strings to preserve uint256 precision.',
        explorer: explorerUrl(network, 'address', contract),
      });
    }),
  );
}

/** Exported for the README generator and the test suite. */
export const KNOWN_TOKEN_LIST = KNOWN_TOKENS;
