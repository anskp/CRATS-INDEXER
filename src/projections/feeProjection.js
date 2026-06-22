import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { Decimal } from '@prisma/client/runtime/library.js';

export async function projectFee(event, tx) {
  const { eventName, txHash, blockNumber, eventPayload, createdAt } = event;
  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;

  if (eventName === 'FeeReceived') {
    const vaultAddress = payload.vault.toLowerCase();
    const amount = new Decimal(payload.amount);
    const from = payload.from.toLowerCase();

    await tx.feeRecord.create({
      data: {
        vaultAddress,
        feeType: 'received',
        amount,
        recipient: from,
        txHash,
        blockNumber,
        timestamp: createdAt
      }
    });

    logger.info(`Fee: Logged fee receipt of ${amount} USDC/USDT for vault ${vaultAddress}`);
  } 
  
  else if (eventName === 'Checkpoint') {
    const vaultAddress = payload.vault.toLowerCase();
    const amount = new Decimal(payload.mgmtFeeAccrued);

    await tx.feeRecord.create({
      data: {
        vaultAddress,
        feeType: 'mgmt_accrued',
        amount,
        recipient: 'FeeEngine',
        txHash,
        blockNumber,
        timestamp: createdAt
      }
    });

    logger.info(`Fee: Logged management fee checkpoint of ${amount} for vault ${vaultAddress}`);
  } 
  
  else if (eventName === 'FeesDistributed') {
    const vaultAddress = payload.vault.toLowerCase();
    const totalDistributed = new Decimal(payload.totalDistributed);

    await tx.feeRecord.create({
      data: {
        vaultAddress,
        feeType: 'distributed',
        amount: totalDistributed,
        recipient: 'Shares (Treasury/Issuer/Compliance/Insurance)',
        txHash,
        blockNumber,
        timestamp: createdAt
      }
    });

    logger.info(`Fee: Logged fee distribution of ${totalDistributed} for vault ${vaultAddress}`);
  }
}
