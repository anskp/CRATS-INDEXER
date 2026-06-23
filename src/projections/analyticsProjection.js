import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { Decimal } from '@prisma/client/runtime/library.js';

function toDecimalValue(value, decimals = 6) {
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

export async function projectAnalytics(event, tx) {
  const { eventName, eventPayload, contractAddress } = event;
  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;

  let tvlChange = new Decimal(0);
  let feeIncrement = new Decimal(0);
  let vaultIncrement = 0;

  if (eventName === 'VaultCreated') {
    vaultIncrement = 1;
  } 
  
  else if (eventName === 'Deposit' || eventName === 'Withdraw') {
    const vaultAddress = contractAddress.toLowerCase();
    const dbVault = await tx.vault.findUnique({
      where: { vaultAddress }
    });
    const assetAddress = dbVault ? dbVault.assetAddress : '';
    const isUSDC = assetAddress === process.env.USDC?.toLowerCase();
    const isUSDT = assetAddress === process.env.USDT?.toLowerCase();
    const assetDecimals = (isUSDC || isUSDT) ? 6 : 18;

    tvlChange = toDecimalValue(payload.assets, assetDecimals);
    if (eventName === 'Withdraw') {
      tvlChange = tvlChange.negated();
    }
  } 
  
  else if (eventName === 'FeeReceived') {
    feeIncrement = toDecimalValue(payload.amount, 6);
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
