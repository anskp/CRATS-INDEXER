import logger from '../config/logger.js';
import { Decimal } from '@prisma/client/runtime/library.js';

export async function projectCarbonRetirement(event, tx) {
  const { eventName, contractAddress, eventPayload, blockNumber, txHash } = event;
  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;

  if (eventName === 'RetirementExecuted' || eventName === 'CarbonRetired') {
    const retirementId = payload.retirementId || `ret_${blockNumber}_${txHash.substring(0, 8)}`;
    const retireeAddress = (payload.retiree || payload.user || payload.investor || '').toLowerCase();
    const amount = new Decimal(payload.amount || payload.creditAmount || 0);

    await tx.carbonRetirementRecord.upsert({
      where: { retirementId },
      create: {
        retirementId,
        retireeAddress,
        amount,
        beneficiaryName: payload.beneficiaryName || 'Corporate Offset',
        retirementReason: payload.retirementReason || 'Voluntary Offset',
        certificateCid: payload.certificateCid || payload.ipfsHash || null,
        status: payload.status || 'SUCCESS',
        txHash,
        blockNumber,
        timestamp: new Date()
      },
      update: {
        status: payload.status || 'SUCCESS',
        txHash,
        blockNumber
      }
    });

    logger.info(`CarbonProjection: Indexed carbon retirement ${retirementId} for ${retireeAddress}`);
  }
}
