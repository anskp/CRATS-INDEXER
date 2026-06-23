import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { Decimal } from '@prisma/client/runtime/library.js';

const valuationMethods = [
  'FULL_APPRAISAL',
  'DESKTOP_APPRAISAL',
  'DCF_MODEL',
  'MARKET_COMPARABLE',
  'AUDIT_VERIFIED',
  'INCOME_STATEMENT'
];

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

export async function projectNAV(event, tx) {
  const { eventName, txHash, blockNumber, eventPayload, createdAt } = event;
  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;

  if (eventName === 'NAVSubmitted') {
    const assetId = payload.assetId;
    const navValue = toDecimalValue(payload.navValue || payload.assetValue, 18);
    const valuationDate = payload.valuationDate
      ? new Date(Number(payload.valuationDate) * 1000)
      : createdAt;
    const methodRaw = Number(payload.method || payload.valuationMethod || 0);
    const method = valuationMethods[methodRaw] || 'UNKNOWN';
    const submitter = payload.submitter.toLowerCase();
    const autoFlagged = payload.autoFlagged === true || payload.autoFlagged === 'true';
    const status = autoFlagged ? 'flagged' : 'submitted';

    await tx.navSubmission.create({
      data: {
        assetId,
        navValue,
        method,
        submitter,
        status,
        valuationDate,
        submittedAt: createdAt,
        txHash,
        blockNumber
      }
    });

    logger.info(`NAV: Logged NAV submission of ${navValue} for asset ${assetId} (Method: ${method}, Status: ${status})`);
  } 
  
  else if (eventName === 'SubmissionFlaggedForReview') {
    const assetId = payload.assetId;

    // Update the latest submission for this asset
    const latest = await tx.navSubmission.findFirst({
      where: { assetId },
      orderBy: { id: 'desc' }
    });

    if (latest) {
      await tx.navSubmission.update({
        where: { id: latest.id },
        data: { status: 'flagged' }
      });
      logger.info(`NAV: Updated latest submission for asset ${assetId} to status 'flagged' due to review event.`);
    }
  } 
  
  else if (eventName === 'DisputeOpened') {
    const assetId = payload.assetId;

    const latest = await tx.navSubmission.findFirst({
      where: { assetId },
      orderBy: { id: 'desc' }
    });

    if (latest) {
      await tx.navSubmission.update({
        where: { id: latest.id },
        data: { status: 'disputed' }
      });
      logger.info(`NAV: Updated latest submission for asset ${assetId} to status 'disputed'`);
    }
  } 
  
  else if (eventName === 'DisputeResolved') {
    const assetId = payload.assetId;
    const approved = payload.approved === true || payload.approved === 'true';

    const latest = await tx.navSubmission.findFirst({
      where: { assetId },
      orderBy: { id: 'desc' }
    });

    if (latest) {
      const status = approved ? 'published' : 'rejected';
      await tx.navSubmission.update({
        where: { id: latest.id },
        data: { status }
      });
      logger.info(`NAV: Updated dispute status for asset ${assetId} to ${status}`);
    }
  }
}
