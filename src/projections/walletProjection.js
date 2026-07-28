import { formatUnits } from 'viem';
import publicClient from '../config/viem.js';
import logger from '../config/logger.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ERC20_READ_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }
];

const roleNames = {
  0: 'ADMIN',
  1: 'INVESTOR',
  2: 'QUALIFIED_INVESTOR',
  3: 'INSTITUTIONAL_INVESTOR',
  4: 'ISSUER',
  5: 'REGULATOR',
  6: 'KYC_PROVIDER'
};

function parsePayload(eventPayload) {
  return typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;
}

function normalizeAddress(address) {
  return address?.toLowerCase() || null;
}

function extractHandle(holderName) {
  return holderName?.startsWith('@') ? holderName : null;
}

async function getBlockTimestamp(tx, blockNumber) {
  const block = await tx.block.findUnique({
    where: { blockNumber },
    select: { timestamp: true }
  });
  return block?.timestamp || new Date();
}

async function upsertBalance(tx, wallet, balance) {
  await tx.walletBalance.upsert({
    where: {
      trackedWalletId_tokenAddress: {
        trackedWalletId: wallet.id,
        tokenAddress: balance.tokenAddress
      }
    },
    create: {
      trackedWalletId: wallet.id,
      ...balance
    },
    update: balance
  });
}

async function refreshNativeBalance(tx, wallet, blockNumber, txHash) {
  const rawBalance = await publicClient.getBalance({ address: wallet.walletAddress });
  await upsertBalance(tx, wallet, {
    tokenAddress: 'NATIVE',
    tokenName: 'Ethereum',
    tokenSymbol: 'ETH',
    tokenType: 'NATIVE',
    decimals: 18,
    balance: formatUnits(rawBalance, 18),
    lastUpdatedBlock: blockNumber,
    lastUpdatedTxHash: txHash
  });
}

async function getTokenMetadata(tx, tokenAddress) {
  const normalizedAddress = tokenAddress.toLowerCase();
  const isUsdc = normalizedAddress === process.env.USDC?.toLowerCase();
  const isUsdt = normalizedAddress === process.env.USDT?.toLowerCase();
  const vault = await tx.vault.findUnique({
    where: { vaultAddress: normalizedAddress },
    select: { name: true, symbol: true }
  });

  const fallback = {
    tokenName: vault?.name || (isUsdc ? 'USD Coin' : isUsdt ? 'Tether USD' : 'ERC-20 Token'),
    tokenSymbol: vault?.symbol || (isUsdc ? 'USDC' : isUsdt ? 'USDT' : 'TOKEN'),
    tokenType: vault ? 'VAULT_SHARE' : 'ERC20',
    decimals: isUsdc || isUsdt ? 6 : 18
  };

  const [name, symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: normalizedAddress, abi: ERC20_READ_ABI, functionName: 'name' }).catch(() => fallback.tokenName),
    publicClient.readContract({ address: normalizedAddress, abi: ERC20_READ_ABI, functionName: 'symbol' }).catch(() => fallback.tokenSymbol),
    publicClient.readContract({ address: normalizedAddress, abi: ERC20_READ_ABI, functionName: 'decimals' }).catch(() => fallback.decimals)
  ]);

  return {
    tokenName: name || fallback.tokenName,
    tokenSymbol: symbol || fallback.tokenSymbol,
    tokenType: fallback.tokenType,
    decimals: Number(decimals)
  };
}

async function refreshTokenBalance(tx, wallet, tokenAddress, blockNumber, txHash) {
  const metadata = await getTokenMetadata(tx, tokenAddress);
  const rawBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_READ_ABI,
    functionName: 'balanceOf',
    args: [wallet.walletAddress]
  });

  await upsertBalance(tx, wallet, {
    tokenAddress: tokenAddress.toLowerCase(),
    ...metadata,
    balance: formatUnits(rawBalance, metadata.decimals),
    lastUpdatedBlock: blockNumber,
    lastUpdatedTxHash: txHash
  });
}

async function trackIdentity(event, tx) {
  const payload = parsePayload(event.eventPayload);
  const walletAddress = normalizeAddress(payload.wallet || payload.primaryWallet);
  if (!walletAddress) return;

  const holderName = payload.holderName || null;
  const hasProfile = event.eventName === 'IdentityProfileRegistered';
  const registeredAt = await getBlockTimestamp(tx, event.blockNumber);
  const role = payload.role === undefined ? null : roleNames[Number(payload.role)] || `ROLE_${payload.role}`;

  const wallet = await tx.trackedWallet.upsert({
    where: { walletAddress },
    create: {
      walletAddress,
      chainId: event.chainId,
      holderName,
      handle: extractHandle(holderName),
      displayName: holderName && !extractHandle(holderName) ? holderName : null,
      did: hasProfile ? payload.did || null : null,
      role,
      jurisdiction: payload.jurisdiction === undefined ? null : Number(payload.jurisdiction),
      identityTokenId: payload.tokenId?.toString() || null,
      registrationBlock: event.blockNumber,
      registrationTxHash: event.txHash,
      registeredAt
    },
    update: {
      ...(hasProfile ? {
        holderName,
        handle: extractHandle(holderName),
        displayName: holderName && !extractHandle(holderName) ? holderName : null,
        did: payload.did || null
      } : {}),
      role,
      jurisdiction: payload.jurisdiction === undefined ? undefined : Number(payload.jurisdiction),
      identityTokenId: payload.tokenId?.toString() || undefined
    }
  });

  // Always fetch native balance and common tokens (USDC/USDT) upon discovery/registration
  await refreshNativeBalance(tx, wallet, event.blockNumber, event.txHash).catch(err => {
    logger.warn(`Could not refresh native balance for ${walletAddress}: ${err.message}`);
  });
  
  if (process.env.USDC) {
    await refreshTokenBalance(tx, wallet, process.env.USDC, event.blockNumber, event.txHash).catch(() => {});
  }
  if (process.env.USDT) {
    await refreshTokenBalance(tx, wallet, process.env.USDT, event.blockNumber, event.txHash).catch(() => {});
  }

  logger.info(`Wallet projection: tracking ${walletAddress}${holderName ? ` for ${holderName}` : ''}.`);
}

export async function projectNativeTransfer({ fromAddress, toAddress, value, blockNumber, txHash }, tx) {
  if (!value || BigInt(value) === 0n) return;

  const addresses = [...new Set([normalizeAddress(fromAddress), normalizeAddress(toAddress)].filter(Boolean))];
  const wallets = await tx.trackedWallet.findMany({ where: { walletAddress: { in: addresses } } });

  for (const wallet of wallets) {
    await refreshNativeBalance(tx, wallet, blockNumber, txHash);
  }
}

export async function projectWallet(event, tx) {
  if (event.eventName === 'IdentityRegistered' || event.eventName === 'IdentityProfileRegistered') {
    await trackIdentity(event, tx);
    return;
  }

  if (event.eventName !== 'Transfer') return;

  const payload = parsePayload(event.eventPayload);
  if (payload.value === undefined || payload.value === null) return;

  const from = normalizeAddress(payload.from);
  const to = normalizeAddress(payload.to);
  const tokenAddress = normalizeAddress(event.contractAddress);
  if (!tokenAddress) return;

  const addresses = [...new Set([from, to].filter((address) => address && address !== ZERO_ADDRESS))];
  const wallets = await tx.trackedWallet.findMany({ where: { walletAddress: { in: addresses } } });

  for (const wallet of wallets) {
    await refreshTokenBalance(tx, wallet, tokenAddress, event.blockNumber, event.txHash);
  }
}
