import logger from '../config/logger.js';
import { Decimal } from '@prisma/client/runtime/library.js';

function toDecimalValue(value, decimals = 18) {
  if (value === undefined || value === null) return new Decimal(0);
  const div = new Decimal(10).pow(decimals);
  let dec = new Decimal(value.toString()).div(div);
  const maxVal = new Decimal('999999999999.999999999999999999');
  if (dec.gt(maxVal)) return maxVal;
  const minVal = new Decimal('-999999999999.999999999999999999');
  if (dec.lt(minVal)) return minVal;
  return dec;
}

export async function projectBeneficialOwnership(event, tx) {
  const { eventName, contractAddress, eventPayload, blockNumber, txHash } = event;
  const payload = typeof eventPayload === 'string' ? JSON.parse(eventPayload) : eventPayload;

  const tokenAddress = contractAddress.toLowerCase();

  if (eventName === 'Transfer' || eventName === 'SyncRouted') {
    const from = (payload.from || payload.sender || '0x0000000000000000000000000000000000000000').toLowerCase();
    const to = (payload.to || payload.investor || payload.recipient || '0x0000000000000000000000000000000000000000').toLowerCase();
    const rawValue = payload.value || payload.amount || payload.shares || 0;
    const value = toDecimalValue(rawValue, 18);

    const isMint = from === '0x0000000000000000000000000000000000000000';
    const isBurn = to === '0x0000000000000000000000000000000000000000';

    // 1. Update BOR for sender
    if (!isMint) {
      const existingSender = await tx.beneficialOwnerRecord.findUnique({
        where: { tokenAddress_investorAddress: { tokenAddress, investorAddress: from } }
      });
      const newSenderBalance = Math.max(0, parseFloat(existingSender?.balance || 0) - parseFloat(value));
      
      await tx.beneficialOwnerRecord.upsert({
        where: { tokenAddress_investorAddress: { tokenAddress, investorAddress: from } },
        create: {
          tokenAddress,
          investorAddress: from,
          balance: new Decimal(0),
          ownershipPercent: new Decimal(0),
          entryNav: new Decimal(1.0),
          totalValueUsd: new Decimal(0),
          lastUpdatedBlock: blockNumber
        },
        update: {
          balance: new Decimal(newSenderBalance),
          lastUpdatedBlock: blockNumber
        }
      });
    }

    // 2. Update BOR for receiver
    if (!isBurn) {
      const existingReceiver = await tx.beneficialOwnerRecord.findUnique({
        where: { tokenAddress_investorAddress: { tokenAddress, investorAddress: to } }
      });
      const newReceiverBalance = parseFloat(existingReceiver?.balance || 0) + parseFloat(value);

      await tx.beneficialOwnerRecord.upsert({
        where: { tokenAddress_investorAddress: { tokenAddress, investorAddress: to } },
        create: {
          tokenAddress,
          investorAddress: to,
          balance: new Decimal(newReceiverBalance),
          ownershipPercent: new Decimal(0),
          entryNav: new Decimal(1.0),
          totalValueUsd: new Decimal(newReceiverBalance),
          lastUpdatedBlock: blockNumber
        },
        update: {
          balance: new Decimal(newReceiverBalance),
          totalValueUsd: new Decimal(newReceiverBalance),
          lastUpdatedBlock: blockNumber
        }
      });
    }

    // 3. Log P2P Secondary Settlement
    if (!isMint && !isBurn) {
      await tx.p2pSettlementLog.create({
        data: {
          swapId: `swap_${blockNumber}_${txHash.substring(0, 10)}`,
          tokenAddress,
          senderAddress: from,
          receiverAddress: to,
          amount: value,
          priceUsd: new Decimal(payload.priceUsd || 1.0),
          settlementType: 'P2P_DVP',
          txHash,
          blockNumber,
          timestamp: new Date()
        }
      });
      logger.info(`BOR: Indexed P2P swap from ${from} to ${to} for token ${tokenAddress}`);
    }
  }
}
