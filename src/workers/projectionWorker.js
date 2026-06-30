import prisma from '../config/db.js';
import publicClient from '../config/viem.js';
import logger from '../config/logger.js';

import { projectPortfolio } from '../projections/portfolioProjection.js';
import { projectVault } from '../projections/vaultProjection.js';
import { projectFee } from '../projections/feeProjection.js';
import { projectSettlement } from '../projections/settlementProjection.js';
import { projectNAV } from '../projections/navProjection.js';
import { projectAnalytics } from '../projections/analyticsProjection.js';

const PROJECTIONS = [
  { name: 'Portfolio', fn: projectPortfolio },
  { name: 'Vault', fn: projectVault },
  { name: 'Fee', fn: projectFee },
  { name: 'Settlement', fn: projectSettlement },
  { name: 'NAV', fn: projectNAV },
  { name: 'Analytics', fn: projectAnalytics }
];

let workerRunning = false;
let workerTimeout = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callWithRetry(fn, retries = 5, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errorStr = error.message || '';
      const isRetryable = errorStr.includes('429') || 
                          errorStr.includes('Too Many Requests') || 
                          errorStr.includes('Too many request') || 
                          errorStr.includes('LimitExceeded') ||
                          errorStr.includes('rate limit') ||
                          errorStr.includes('timeout') ||
                          errorStr.includes('Timeout') ||
                          errorStr.includes('limit');
      
      if (isRetryable && attempt < retries) {
        const waitTime = delayMs * Math.pow(2, attempt - 1);
        logger.warn(`RPC Transient error in projectionWorker: "${errorStr.substring(0, 80)}". Retrying in ${waitTime}ms... (Attempt ${attempt}/${retries})`);
        await sleep(waitTime);
        continue;
      }
      throw error;
    }
  }
}

export function startWorker() {
  logger.info('Starting Projection Worker Service...');
  runWorkerLoop();
}

async function runWorkerLoop() {
  if (workerRunning) return;
  workerRunning = true;

  try {
    const currentBlock = Number(await callWithRetry(() => publicClient.getBlockNumber()));

    // SELECT ... FOR UPDATE SKIP LOCKED
    // Dual confirmation strategy:
    // Financial events (Deposit, Withdraw, Transfer, Checkpoint, FeesDistributed, FeeReceived, RedemptionRequested, etc.) need 12 confirmations.
    // Non-financial events (VaultCreated, AssetCreated, and others) need 5 confirmations.
    const query = `
      SELECT *
      FROM blockchain_events
      WHERE status = 'pending'
        AND is_removed = 0
        AND (
          (
            event_name IN (
              'Deposit', 'Withdraw', 'Transfer', 'FeeReceived', 'FeesDistributed', 'Checkpoint',
              'RedemptionRequested', 'RedemptionProcessed', 'RedemptionClaimed', 'RedemptionCancelled',
              'RedemptionQueueCreated', 'YieldSyncRequired', 'SettlementInitiated', 'SettlementCompleted', 'SettlementFailed'
            )
            AND block_number <= ${currentBlock - 12}
          )
          OR
          (
            event_name NOT IN (
              'Deposit', 'Withdraw', 'Transfer', 'FeeReceived', 'FeesDistributed', 'Checkpoint',
              'RedemptionRequested', 'RedemptionProcessed', 'RedemptionClaimed', 'RedemptionCancelled',
              'RedemptionQueueCreated', 'YieldSyncRequired', 'SettlementInitiated', 'SettlementCompleted', 'SettlementFailed'
            )
            AND block_number <= ${currentBlock - 5}
          )
        )
      ORDER BY block_number ASC, log_index ASC
      LIMIT 50
      FOR UPDATE
      SKIP LOCKED
    `;

    const pendingEvents = await prisma.$queryRawUnsafe(query);

    if (pendingEvents && pendingEvents.length > 0) {
      logger.info(`Claimed ${pendingEvents.length} events for processing.`);

      for (const event of pendingEvents) {
        const mappedEvent = {
          eventId: BigInt(event.event_id),
          chainId: Number(event.chain_id),
          blockNumber: BigInt(event.block_number),
          blockHash: event.block_hash,
          parentHash: event.parent_hash,
          txHash: event.tx_hash,
          logIndex: Number(event.log_index),
          contractAddress: event.contract_address,
          eventName: event.event_name,
          eventVersion: event.event_version,
          eventPayload: event.event_payload,
          isRemoved: Boolean(event.is_removed),
          status: event.status,
          createdAt: event.created_at
        };
        await processEvent(mappedEvent);
      }
    }
  } catch (error) {
    logger.error('Error in projection worker loop:', error);
  }

  workerRunning = false;
  workerTimeout = setTimeout(runWorkerLoop, 1500); // Poll every 1.5 seconds
}

async function processEvent(event) {
  const eventId = event.eventId;
  const eventName = event.eventName;
  
  logger.info(`Processing event #${eventId} (${eventName})`);

  // Set state to processing in the main DB
  await prisma.blockchainEvent.update({
    where: { eventId },
    data: { status: 'processing' }
  });

  let allSucceeded = true;
  const failedProjections = [];

  for (const projection of PROJECTIONS) {
    try {
      await prisma.$transaction(async (tx) => {
        // Check if already processed by this projection
        const alreadyProcessed = await tx.processedEvent.findUnique({
          where: {
            eventId_projectionName: {
              eventId,
              projectionName: projection.name
            }
          }
        });

        if (alreadyProcessed) {
          return; // skip
        }

        // Execute projection logic
        await projection.fn(event, tx);

        // Record processed state
        await tx.processedEvent.create({
          data: {
            eventId,
            projectionName: projection.name
          }
        });
      });
    } catch (error) {
      allSucceeded = false;
      failedProjections.push({ name: projection.name, error: error.message });
      logger.error(`Projection ${projection.name} failed on event #${eventId} (${eventName}): ${error.message}`, error);

      // Log to Dead Letter Queue (DLQ)
      try {
        await prisma.deadLetterEvent.upsert({
          where: {
            id: 0 // Dummy or use unique criteria/create
          },
          // Workaround since prisma upsert requires a unique identifier: just use create
          create: {
            eventId,
            projectionName: projection.name,
            errorMessage: error.stack || error.message,
            status: 'pending',
            retryCount: 0
          },
          update: {
            errorMessage: error.stack || error.message,
            status: 'pending',
            retryCount: { increment: 1 }
          }
        });
      } catch (dlqErr) {
        // Fallback create
        await prisma.deadLetterEvent.create({
          data: {
            eventId,
            projectionName: projection.name,
            errorMessage: error.stack || error.message,
            status: 'pending',
            retryCount: 0
          }
        }).catch(err => logger.error(`Could not write to DLQ: ${err.message}`));
      }
    }
  }

  // Update final status of event
  if (allSucceeded) {
    await prisma.blockchainEvent.update({
      where: { eventId },
      data: { status: 'processed' }
    });
    logger.info(`Event #${eventId} (${eventName}) processed successfully by all projections.`);
  } else {
    await prisma.blockchainEvent.update({
      where: { eventId },
      data: { status: 'failed' }
    });
    logger.warn(`Event #${eventId} (${eventName}) marked as 'failed'. Projections failed: ${failedProjections.map(p => p.name).join(', ')}`);
  }
}

export function stopWorker() {
  if (workerTimeout) clearTimeout(workerTimeout);
  workerRunning = false;
  logger.info('Projection Worker Service stopped.');
}
