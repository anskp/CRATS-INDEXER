import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { projectPortfolio } from '../projections/portfolioProjection.js';
import { projectVault } from '../projections/vaultProjection.js';
import { projectFee } from '../projections/feeProjection.js';
import { projectSettlement } from '../projections/settlementProjection.js';
import { projectNAV } from '../projections/navProjection.js';
import { projectAnalytics } from '../projections/analyticsProjection.js';

const PROJECTIONS_MAP = {
  portfolio: {
    name: 'Portfolio',
    fn: projectPortfolio,
    clear: async (tx) => {
      logger.info('Clearing portfolio positions...');
      await tx.portfolioPosition.deleteMany({});
    }
  },
  vault: {
    name: 'Vault',
    fn: projectVault,
    clear: async (tx) => {
      logger.info('Clearing vaults...');
      await tx.vault.deleteMany({});
    }
  },
  fee: {
    name: 'Fee',
    fn: projectFee,
    clear: async (tx) => {
      logger.info('Clearing fee records...');
      await tx.feeRecord.deleteMany({});
    }
  },
  settlement: {
    name: 'Settlement',
    fn: projectSettlement,
    clear: async (tx) => {
      logger.info('Clearing settlements...');
      await tx.settlement.deleteMany({});
    }
  },
  nav: {
    name: 'NAV',
    fn: projectNAV,
    clear: async (tx) => {
      logger.info('Clearing NAV submissions...');
      await tx.navSubmission.deleteMany({});
    }
  },
  analytics: {
    name: 'Analytics',
    fn: projectAnalytics,
    clear: async (tx) => {
      logger.info('Clearing protocol metrics...');
      await tx.protocolMetric.deleteMany({});
    }
  }
};

async function runReplay() {
  const args = process.argv.slice(2);
  const allArg = args.includes('--all');
  const projArg = args.find(a => a.startsWith('--projection='));
  
  let targetProjections = [];

  if (allArg) {
    targetProjections = Object.keys(PROJECTIONS_MAP);
  } else if (projArg) {
    const projName = projArg.split('=')[1]?.toLowerCase();
    if (PROJECTIONS_MAP[projName]) {
      targetProjections = [projName];
    } else {
      logger.error(`Unknown projection: ${projName}. Available projections: ${Object.keys(PROJECTIONS_MAP).join(', ')}`);
      process.exit(1);
    }
  } else {
    logger.error('Usage: npm run replay -- [--all] [--projection=name]');
    process.exit(1);
  }

  logger.info(`====================================================`);
  logger.info(`Starting Event Replay for: ${targetProjections.join(', ')}`);
  logger.info(`====================================================`);

  try {
    await prisma.$connect();

    // Fetch all canonical events from ledger
    const events = await prisma.blockchainEvent.findMany({
      where: { isRemoved: false },
      orderBy: [
        { blockNumber: 'asc' },
        { logIndex: 'asc' }
      ]
    });

    logger.info(`Found ${events.length} canonical events in ledger.`);

    for (const key of targetProjections) {
      const target = PROJECTIONS_MAP[key];
      logger.info(`Rebuilding projection: ${target.name}`);

      await prisma.$transaction(async (tx) => {
        // Clear read model tables
        await target.clear(tx);

        // Delete previous processed state for this projection
        await tx.processedEvent.deleteMany({
          where: { projectionName: target.name }
        });

        // Reset state pointer
        await tx.projectionState.upsert({
          where: { projectionName: target.name },
          create: { projectionName: target.name, lastEventId: 0n },
          update: { lastEventId: 0n }
        });

        let count = 0;
        // Process each event sequentially
        for (const event of events) {
          await target.fn(event, tx);
          
          await tx.processedEvent.create({
            data: {
              eventId: event.eventId,
              projectionName: target.name
            }
          });

          await tx.projectionState.update({
            where: { projectionName: target.name },
            data: { lastEventId: event.eventId }
          });
          
          count++;
        }

        logger.info(`Successfully replayed ${count} events for ${target.name}`);
      });
    }

    logger.info('====================================================');
    logger.info('Event Replay Completed Successfully.');
    logger.info('====================================================');
  } catch (error) {
    logger.error('Replay failed with error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runReplay();
