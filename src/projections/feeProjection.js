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

export async function projectFee(event, tx) {
  const { eventName, txHash, blockNumber, eventPayload, createdAt } = event;
  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;

  if (eventName === 'FeeReceived') {
    const vaultAddress = payload.vault.toLowerCase();
    const amount = toDecimalValue(payload.amount, 6);
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
    const amount = toDecimalValue(payload.mgmtFeeAccrued, 18);

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
    const totalDistributed = toDecimalValue(payload.totalDistributed, 18);

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
