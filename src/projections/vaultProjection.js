import prisma from '../config/db.js';
import publicClient from '../config/viem.js';
import logger from '../config/logger.js';
import * as ABIs from '../config/contractABIs.js';
import { hexToString } from 'viem';
import { Decimal } from '@prisma/client/runtime/library.js';

export async function projectVault(event, tx) {
  const { eventName, contractAddress, eventPayload } = event;
  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;

  if (eventName === 'VaultCreated') {
    const vaultAddress = (payload.vault || payload.vaultAddress).toLowerCase();
    const assetAddress = payload.asset.toLowerCase();
    const categoryHex = payload.category;
    const vaultTypeRaw = payload.vaultType; // 0 for SYNC, 1 for ASYNC
    const creator = payload.creator.toLowerCase();

    let category = 'Unknown';
    if (categoryHex) {
      const lowerHex = categoryHex.toLowerCase();
      if (lowerHex === '0x1846b7be1ac0930d754461a379773a1bafed29e8f13bbd3dafee783511e85ab0') {
        category = 'REAL_ESTATE';
      } else if (lowerHex === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        category = 'NONE';
      } else {
        try {
          const decoded = hexToString(categoryHex).replace(/\0/g, '');
          if (decoded.length > 0 && /^[\x20-\x7E\s]+$/.test(decoded)) {
            category = decoded;
          } else {
            category = categoryHex;
          }
        } catch (e) {
          category = categoryHex;
        }
      }
    }

    // Query name and symbol on-chain via Viem
    let name = 'CRATS Vault';
    let symbol = 'CRATS-V';
    try {
      const [vName, vSymbol] = await Promise.all([
        publicClient.readContract({
          address: vaultAddress,
          abi: ABIs.SyncVaultABI,
          functionName: 'name'
        }),
        publicClient.readContract({
          address: vaultAddress,
          abi: ABIs.SyncVaultABI,
          functionName: 'symbol'
        })
      ]);
      name = vName;
      symbol = vSymbol;
    } catch (err) {
      logger.warn(`Could not query name/symbol for vault ${vaultAddress} on-chain: ${err.message}`);
    }

    const vaultType = vaultTypeRaw === 0 || vaultTypeRaw === 'SYNC' ? 'SYNC' : 'ASYNC';

    await tx.vault.upsert({
      where: { vaultAddress },
      create: {
        vaultAddress,
        assetAddress,
        name,
        symbol,
        category,
        vaultType,
        creator,
        tvl: new Decimal(0),
        totalShares: new Decimal(0),
        active: true
      },
      update: {
        active: true
      }
    });

    logger.info(`Vault: Dynamically discovered and registered new vault: ${name} (${symbol}) at ${vaultAddress}`);
  } 
  
  else if (eventName === 'Deposit') {
    const vaultAddress = contractAddress.toLowerCase();
    const assets = new Decimal(payload.assets);
    const shares = new Decimal(payload.shares);

    await tx.vault.updateMany({
      where: { vaultAddress },
      data: {
        tvl: { increment: assets },
        totalShares: { increment: shares }
      }
    });

    logger.info(`Vault: Added ${assets} AUM to vault ${vaultAddress} on deposit.`);
  } 
  
  else if (eventName === 'Withdraw') {
    const vaultAddress = contractAddress.toLowerCase();
    const assets = new Decimal(payload.assets);
    const shares = new Decimal(payload.shares);

    await tx.vault.updateMany({
      where: { vaultAddress },
      data: {
        tvl: { decrement: assets },
        totalShares: { decrement: shares }
      }
    });

    logger.info(`Vault: Subtracted ${assets} AUM from vault ${vaultAddress} on withdrawal.`);
  }
}
