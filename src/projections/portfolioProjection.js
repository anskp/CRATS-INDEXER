import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { Decimal } from '@prisma/client/runtime/library.js';

function toDecimalValue(value, decimals = 18) {
  if (value === undefined || value === null) return new Decimal(0);
  const div = new Decimal(10).pow(decimals);
  let dec = new Decimal(value.toString()).div(div);
  const maxVal = new Decimal('999999999999.999999999999999999');
  if (dec.gt(maxVal)) {
    logger.warn(`Value ${dec} exceeds MySQL Decimal(30, 18) range. Capping at ${maxVal}`);
    return maxVal;
  }
  const minVal = new Decimal('-999999999999.999999999999999999');
  if (dec.lt(minVal)) {
    logger.warn(`Value ${dec} is below MySQL Decimal(30, 18) range. Capping at ${minVal}`);
    return minVal;
  }
  return dec;
}

export async function projectPortfolio(event, tx) {
  const { eventName, contractAddress, eventPayload, blockNumber } = event;
  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;

  const vaultAddress = contractAddress.toLowerCase();
  const isUSDC = vaultAddress === process.env.USDC?.toLowerCase();
  const isUSDT = vaultAddress === process.env.USDT?.toLowerCase();
  const isVaultToken = !isUSDC && !isUSDT;

  if (eventName === 'Deposit') {
    const owner = payload.owner.toLowerCase();
    const shares = toDecimalValue(payload.shares, 18);

    // 1. Update Portfolio Position (Vault specific)
    if (isVaultToken) {
      await tx.portfolioPosition.upsert({
        where: {
          walletAddress_vaultAddress: {
            walletAddress: owner,
            vaultAddress: vaultAddress
          }
        },
        create: {
          walletAddress: owner,
          vaultAddress: vaultAddress,
          shares: shares,
          lastUpdatedBlock: blockNumber
        },
        update: {
          shares: { increment: shares },
          lastUpdatedBlock: blockNumber
        }
      });
    }

    // 2. Update TokenHolder (Leaderboard)
    await tx.tokenHolder.upsert({
      where: {
        tokenAddress_holderAddress: {
          tokenAddress: vaultAddress,
          holderAddress: owner
        }
      },
      create: {
        tokenAddress: vaultAddress,
        holderAddress: owner,
        balance: shares
      },
      update: {
        balance: { increment: shares }
      }
    });

    logger.info(`Portfolio/Holder: Updated deposit for ${owner} in vault ${vaultAddress}. Added ${shares} shares.`);
  } 
  
  else if (eventName === 'Withdraw') {
    const owner = payload.owner.toLowerCase();
    const shares = toDecimalValue(payload.shares, 18);

    // 1. Update Portfolio Position (Vault specific)
    if (isVaultToken) {
      await tx.portfolioPosition.upsert({
        where: {
          walletAddress_vaultAddress: {
            walletAddress: owner,
            vaultAddress: vaultAddress
          }
        },
        create: {
          walletAddress: owner,
          vaultAddress: vaultAddress,
          shares: shares.negated(),
          lastUpdatedBlock: blockNumber
        },
        update: {
          shares: { decrement: shares },
          lastUpdatedBlock: blockNumber
        }
      });
    }

    // 2. Update TokenHolder (Leaderboard)
    await tx.tokenHolder.upsert({
      where: {
        tokenAddress_holderAddress: {
          tokenAddress: vaultAddress,
          holderAddress: owner
        }
      },
      create: {
        tokenAddress: vaultAddress,
        holderAddress: owner,
        balance: shares.negated()
      },
      update: {
        balance: { decrement: shares }
      }
    });

    logger.info(`Portfolio/Holder: Updated withdrawal for ${owner} from vault ${vaultAddress}. Removed ${shares} shares.`);
  } 
  
  else if (eventName === 'Transfer') {
    const from = payload.from.toLowerCase();
    const to = payload.to.toLowerCase();
    
    const rawValue = payload.value || payload.amount || payload.shares;
    if (rawValue === undefined) {
      // Skip non-fungible transfers (e.g. ERC721 Transfer events with tokenId)
      return;
    }
    const value = toDecimalValue(rawValue, isVaultToken ? 18 : 6);

    const isMint = from === '0x0000000000000000000000000000000000000000' || from === '0x0000000000000000000000000000000000000001';
    const isBurn = to === '0x0000000000000000000000000000000000000000' || to === '0x0000000000000000000000000000000000000001';

    // 1. Update TokenHolder for sender
    if (!isMint) {
      await tx.tokenHolder.upsert({
        where: {
          tokenAddress_holderAddress: {
            tokenAddress: vaultAddress,
            holderAddress: from
          }
        },
        create: {
          tokenAddress: vaultAddress,
          holderAddress: from,
          balance: value.negated()
        },
        update: {
          balance: { decrement: value }
        }
      });
    }

    // 2. Update TokenHolder for receiver
    if (!isBurn) {
      await tx.tokenHolder.upsert({
        where: {
          tokenAddress_holderAddress: {
            tokenAddress: vaultAddress,
            holderAddress: to
          }
        },
        create: {
          tokenAddress: vaultAddress,
          holderAddress: to,
          balance: value
        },
        update: {
          balance: { increment: value }
        }
      });
    }

    // 3. Update Portfolio Position (Vault specific, ignore mints/burns since they are handled in Deposit/Withdraw)
    if (isVaultToken && !isMint && !isBurn) {
      // Decrease from sender
      await tx.portfolioPosition.upsert({
        where: {
          walletAddress_vaultAddress: {
            walletAddress: from,
            vaultAddress: vaultAddress
          }
        },
        create: {
          walletAddress: from,
          vaultAddress: vaultAddress,
          shares: value.negated(),
          lastUpdatedBlock: blockNumber
        },
        update: {
          shares: { decrement: value },
          lastUpdatedBlock: blockNumber
        }
      });

      // Increase to receiver
      await tx.portfolioPosition.upsert({
        where: {
          walletAddress_vaultAddress: {
            walletAddress: to,
            vaultAddress: vaultAddress
          }
        },
        create: {
          walletAddress: to,
          vaultAddress: vaultAddress,
          shares: value,
          lastUpdatedBlock: blockNumber
        },
        update: {
          shares: { increment: value },
          lastUpdatedBlock: blockNumber
        }
      });
    }

    logger.info(`Portfolio/Holder: Transfer from ${from} to ${to} of ${value} shares/tokens in ${vaultAddress}.`);
  }
}
