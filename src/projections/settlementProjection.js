import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { Decimal } from '@prisma/client/runtime/library.js';

export async function projectSettlement(event, tx) {
  const { eventName, txHash, blockNumber, eventPayload, createdAt } = event;
  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;

  // ─── RedemptionManager Events ────────────────────────────────
  if (eventName === 'RedemptionRequested') {
    const vaultAddress = payload.vault.toLowerCase();
    const requestId = payload.requestId.toString();
    const investor = payload.investor.toLowerCase();
    const shares = new Decimal(payload.shares);
    const requestTime = payload.requestTime
      ? new Date(Number(payload.requestTime) * 1000)
      : createdAt;

    await tx.settlement.upsert({
      where: {
        vaultAddress_requestId: {
          vaultAddress,
          requestId
        }
      },
      create: {
        vaultAddress,
        requestId,
        investor,
        shares,
        assets: new Decimal(0),
        status: 'pending',
        requestTime,
        txHash,
        blockNumber
      },
      update: {
        investor,
        shares,
        requestTime,
        txHash,
        blockNumber
      }
    });

    logger.info(`Settlement: Redemption request #${requestId} logged for investor ${investor} in vault ${vaultAddress}`);
  } 
  
  else if (eventName === 'RedemptionProcessed') {
    const vaultAddress = payload.vault.toLowerCase();
    const requestId = payload.requestId.toString();
    const assets = new Decimal(payload.assets);

    await tx.settlement.updateMany({
      where: {
        vaultAddress,
        requestId
      },
      data: {
        assets,
        status: 'processed'
      }
    });

    logger.info(`Settlement: Redemption request #${requestId} processed with ${assets} assets in vault ${vaultAddress}`);
  } 
  
  else if (eventName === 'RedemptionClaimed') {
    const vaultAddress = payload.vault.toLowerCase();
    const requestId = payload.requestId.toString();
    const assets = new Decimal(payload.assets);

    await tx.settlement.updateMany({
      where: {
        vaultAddress,
        requestId
      },
      data: {
        assets,
        status: 'claimed',
        settleTime: createdAt
      }
    });

    logger.info(`Settlement: Redemption request #${requestId} claimed by investor in vault ${vaultAddress}`);
  } 
  
  else if (eventName === 'RedemptionCancelled') {
    const vaultAddress = payload.vault.toLowerCase();
    const requestId = payload.requestId.toString();

    await tx.settlement.updateMany({
      where: {
        vaultAddress,
        requestId
      },
      data: {
        status: 'cancelled'
      }
    });

    logger.info(`Settlement: Redemption request #${requestId} cancelled in vault ${vaultAddress}`);
  }

  // ─── SettlementEngine (Secondary Market) Events ──────────────
  else if (eventName === 'SettlementInitiated') {
    const settlementId = payload.id.toLowerCase();
    const buyer = payload.buyer.toLowerCase();
    const seller = payload.seller.toLowerCase();
    const token = payload.token.toLowerCase();
    const amount = new Decimal(payload.amount);
    const price = new Decimal(payload.price);
    
    // Estimate assets as amount * price
    const assets = amount.mul(price);

    await tx.settlement.upsert({
      where: {
        vaultAddress_requestId: {
          vaultAddress: token,
          requestId: settlementId
        }
      },
      create: {
        vaultAddress: token,
        requestId: settlementId,
        investor: buyer,
        shares: amount,
        assets,
        status: 'pending',
        requestTime: createdAt,
        txHash,
        blockNumber
      },
      update: {
        investor: buyer,
        shares: amount,
        assets,
        status: 'pending',
        txHash,
        blockNumber
      }
    });

    logger.info(`Settlement: Secondary market settlement ${settlementId} initiated (Token: ${token}, Buyer: ${buyer}, Seller: ${seller})`);
  } 
  
  else if (eventName === 'SettlementCompleted') {
    const settlementId = payload.id.toLowerCase();

    await tx.settlement.updateMany({
      where: {
        requestId: settlementId
      },
      data: {
        status: 'completed',
        settleTime: createdAt
      }
    });

    logger.info(`Settlement: Secondary market settlement ${settlementId} completed`);
  } 
  
  else if (eventName === 'SettlementFailed') {
    const settlementId = payload.id.toLowerCase();

    await tx.settlement.updateMany({
      where: {
        requestId: settlementId
      },
      data: {
        status: 'failed'
      }
    });

    logger.info(`Settlement: Secondary market settlement ${settlementId} failed`);
  }
}
