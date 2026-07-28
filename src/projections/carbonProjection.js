import logger from '../config/logger.js';
import { Decimal } from '@prisma/client/runtime/library.js';
import publicClient from '../config/viem.js';
import * as ABIs from '../config/contractABIs.js';

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

  // 1. CarbonAssetRegistered
  else if (eventName === 'CarbonAssetRegistered') {
    const assetToken = (payload.assetToken || '').toLowerCase();
    const serialStart = payload.serialStart || '';
    const serialEnd = payload.serialEnd || '';
    const registryProjectId = payload.registryProjectId || '';

    logger.info(`CarbonProjection: CarbonAssetRegistered caught for ${assetToken}. Fetching full metadata...`);

    let metadata = {
      projectId: registryProjectId,
      methodology: 'VM0048',
      projectType: 'AFFORESTATION',
      country: 'Global',
      standard: 'VERRA',
      verificationReportHash: '0x',
      pddHash: '0x',
      monitoringReportHash: '0x',
      issuanceCertificateHash: '0x',
      immobilizationProofHash: '0x',
      icvcmApproved: true
    };

    // Query CarbonAssetMetadataStore on-chain for the full struct
    try {
      const storeAddress = contractAddress;
      const metaStruct = await publicClient.readContract({
        address: storeAddress,
        abi: ABIs.CarbonMetadataStoreABI,
        functionName: 'getCarbonMetadata',
        args: [assetToken]
      });

      if (metaStruct) {
        metadata.methodology = metaStruct.methodology || metadata.methodology;
        metadata.projectType = metaStruct.projectType === 0 ? 'AFFORESTATION' : 'REDD_PLUS';
        metadata.country = metaStruct.country || metadata.country;
        metadata.standard = metaStruct.registryType === 0 ? 'VERRA' : 'GOLD_STANDARD';
        metadata.verificationReportHash = metaStruct.verificationReportHash || metadata.verificationReportHash;
        metadata.validationReportHash = metaStruct.validationReportHash;
        metadata.monitoringReportHash = metaStruct.monitoringReportHash || metadata.monitoringReportHash;
        metadata.issuanceCertificateHash = metaStruct.issuanceCertificateHash || metadata.issuanceCertificateHash;
        metadata.immobilizationProofHash = metaStruct.immobilizationProofHash || metadata.immobilizationProofHash;
        metadata.icvcmApproved = metaStruct.ccpStatus === 0;
      }
    } catch (err) {
      logger.warn(`CarbonProjection: Could not query full on-chain metadata for ${assetToken}: ${err.message}`);
    }

    await tx.carbonAssetMetadata.upsert({
      where: { assetId: assetToken },
      create: {
        assetId: assetToken,
        contractAddress: assetToken,
        projectId: metadata.projectId,
        methodology: metadata.methodology,
        projectType: metadata.projectType,
        country: metadata.country,
        standard: metadata.standard,
        serialNumberRange: `${serialStart} - ${serialEnd}`,
        verificationReportHash: metadata.verificationReportHash.toString(),
        pddHash: metadata.pddHash || '0x',
        monitoringReportHash: metadata.monitoringReportHash.toString(),
        issuanceCertificateHash: metadata.issuanceCertificateHash.toString(),
        immobilizationProofHash: metadata.immobilizationProofHash.toString(),
        icvcmApproved: metadata.icvcmApproved
      },
      update: {
        serialNumberRange: `${serialStart} - ${serialEnd}`,
        projectId: metadata.projectId
      }
    });

    logger.info(`CarbonProjection: Stored carbon asset metadata for ${assetToken}`);
  }

  // 2. BatchAdded
  else if (eventName === 'BatchAdded') {
    const assetToken = (payload.assetToken || '').toLowerCase();
    const batchIdRaw = payload.batchId !== undefined ? payload.batchId.toString() : '0';
    const batchId = `${assetToken}_${batchIdRaw}`;
    const totalCredits = toDecimalValue(payload.totalCredits || 0, 18);
    const vintage = payload.vintage !== undefined ? Number(payload.vintage) : 2026;

    await tx.carbonBatch.upsert({
      where: { batchId },
      create: {
        batchId,
        assetId: assetToken,
        vintageYear: vintage,
        totalCredits,
        availableCredits: totalCredits,
        retiredCredits: new Decimal(0)
      },
      update: {
        totalCredits,
        vintageYear: vintage
      }
    });

    logger.info(`CarbonProjection: Logged new carbon batch ${batchId} vintage ${vintage} total credits ${totalCredits}`);
  }
}
