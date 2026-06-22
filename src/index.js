import 'dotenv/config';
import logger from './config/logger.js';
import prisma from './config/db.js';
import { startSync, stopSync } from './sync/blockSync.js';
import { startWorker, stopWorker } from './workers/projectionWorker.js';
import { startApiServer, stopApiServer } from './api/server.js';


logger.info('====================================================');
logger.info('   CRATS Blockchain Indexer - Booting Services   ');
logger.info('====================================================');

async function main() {
  try {
    // 1. Connect to database
    logger.info('Connecting to indexer_db Database...');
    await prisma.$connect();
    logger.info('Database connection successful.');

    // 2. Start sub-services
    startApiServer();
    await startSync();
    startWorker();

    logger.info('All services initialized and running.');
  } catch (error) {
    logger.error('Fatal error during boot sequence:', error);
    process.exit(1);
  }
}

async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  stopSync();
  stopWorker();
  stopApiServer();

  try {
    await prisma.$disconnect();
    logger.info('Database client disconnected.');
  } catch (error) {
    logger.error('Error disconnecting database client:', error);
  }

  logger.info('Graceful shutdown completed. Exiting process.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

main();
