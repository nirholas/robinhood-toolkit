/**
 * robinhood-toolkit · browser connect flow logic
 * Author: nirholas · https://github.com/nirholas/robinhood-toolkit
 * License: MIT (c) 2026 nirholas
 *
 * EIP-1193 connect: request accounts, add the network with the EIP-3085 payload
 * from packages/network (prompt 02), switch to it, then render the address and
 * balance. The payloads are imported directly from wallet-config.js — no
 * duplicated chain IDs — which is why this app must be served from the REPO
 * ROOT so the relative import resolves. See README.md.
 */
import { addChainParams } from '../../packages/network/src/wallet-config.js';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const detailsEl = $('details');
const connectBtn = $('connect');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function selectedNetwork() {
  return document.querySelector('input[name="network"]:checked').value;
}

/** wei hex → ETH string, without pulling in a bignum lib. */
function formatEther(weiHex) {
  const wei = BigInt(weiHex);
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

async function connect() {
  const provider = window.ethereum;
  if (!provider) {
    setStatus('No EIP-1193 wallet found. Install a browser wallet and reload.', true);
    return;
  }

  const net = selectedNetwork();
  const params = addChainParams[net];

  connectBtn.disabled = true;
  try {
    setStatus('Requesting account access…');
    const [address] = await provider.request({ method: 'eth_requestAccounts' });

    // Add first (idempotent — wallets no-op an already-known chain), then switch.
    setStatus(`Adding ${params.chainName}…`);
    await provider.request({ method: 'wallet_addEthereumChain', params: [params] });

    setStatus(`Switching to ${params.chainName}…`);
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: params.chainId }],
    });

    const [chainIdHex, balanceHex] = await Promise.all([
      provider.request({ method: 'eth_chainId' }),
      provider.request({ method: 'eth_getBalance', params: [address, 'latest'] }),
    ]);

    $('address').textContent = address;
    $('chainId').textContent = `${parseInt(chainIdHex, 16)}  (${chainIdHex})`;
    $('balance').textContent = `${formatEther(balanceHex)} ETH`;
    const explorer = $('explorer');
    explorer.href = `${params.blockExplorerUrls[0]}/address/${address}`;
    explorer.textContent = `${params.blockExplorerUrls[0]}/address/${address}`;
    detailsEl.classList.remove('hidden');
    setStatus(`Connected to ${params.chainName}.`);
  } catch (err) {
    // EIP-1193 userRejectedRequest is 4001; anything else is surfaced verbatim.
    const msg = err?.code === 4001 ? 'Request rejected in the wallet.' : err?.message || String(err);
    setStatus(msg, true);
  } finally {
    connectBtn.disabled = false;
  }
}

connectBtn.addEventListener('click', connect);

// Re-render on chain/account changes the user makes in the wallet directly.
window.ethereum?.on?.('chainChanged', () => setStatus('Network changed in wallet. Reconnect to refresh.'));
window.ethereum?.on?.('accountsChanged', () => setStatus('Account changed in wallet. Reconnect to refresh.'));
