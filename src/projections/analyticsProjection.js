import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { Decimal } from '@prisma/client/runtime/library.js';

export async function projectAnalytics(event, tx) {
  const { eventName, eventPayload } = event;
  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;

  let tvlChange = new Decimal(0);
  let feeIncrement = new Decimal(0);
  let vaultIncrement = 0;

  if (eventName === 'VaultCreated') {
    vaultIncrement = 1;
  } 
  
  else if (eventName === 'Deposit') {
    tvlChange = new Decimal(payload.assets);
  } 
  
  else if (eventName === 'Withdraw') {
    tvlChange = new Decimal(payload.assets).negated();
  } 
  
  else if (eventName === 'FeeReceived') {
    feeIncrement = new Decimal(payload.amount);
  }

  // If there's any change, update the protocol metrics row (ID=1)
  if (!tvlChange.isZero() || feeIncrement.gt(0) || vaultIncrement > 0) {
    
    // Calculate current total TVL across all vaults to ensure alignment
    const tvlAgg = await tx.vault.aggregate({
      _sum: { tvl: true }
    });
    let totalTvl = tvlAgg._sum.tvl || new Decimal(0);
    // Apply tvlChange on top
    totalTvl = totalTvl.add(tvlChange);

    await tx.protocolMetric.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        tvl: totalTvl,
        totalFees: feeIncrement,
        activeVaults: vaultIncrement
      },
      update: {
        tvl: totalTvl,
        totalFees: { increment: feeIncrement },
        activeVaults: { increment: vaultIncrement }
      }
    });

    logger.info(`Analytics: Updated protocol metrics. TVL: ${totalTvl}, Total Fees Accrued: +${feeIncrement}, Active Vaults: +${vaultIncrement}`);
  }
}
