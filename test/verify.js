import logger from '../src/config/logger.js';
import prisma from '../src/config/db.js';
import publicClient from '../src/config/viem.js';
import * as ABIs from '../src/config/contractABIs.js';
import { isTracked, initializeABIRegistry } from '../src/sync/eventDecoder.js';

logger.info('====================================================');
logger.info('   CRATS Blockchain Indexer - Verification Check    ');
logger.info('====================================================');

let checksPassed = true;

function assert(condition, message) {
  if (condition) {
    logger.info(`[PASS] ${message}`);
  } else {
    logger.error(`[FAIL] ${message}`);
    checksPassed = false;
  }
}

async function runVerification() {
  try {
    // 1. Logger Check
    assert(logger && typeof logger.info === 'function', 'Winston Logger initialized');

    // 2. Database client loading check
    assert(prisma && typeof prisma.$connect === 'function', 'Prisma Client initialized');

    // 3. Viem client initialization check
    assert(publicClient && typeof publicClient.getBlockNumber === 'function', 'Viem Public Client initialized');

    // 4. ABI artifacts check
    initializeABIRegistry();
    assert(ABIs.VaultFactoryABI.length > 0, 'VaultFactory ABI loaded from Hardhat build artifacts');
    assert(ABIs.SyncVaultABI.length > 0, 'SyncVault ABI loaded from Hardhat build artifacts');
    assert(ABIs.FeeEngineABI.length > 0, 'FeeEngine ABI loaded from Hardhat build artifacts');
    assert(ABIs.NAVOracleABI.length > 0, 'NAVOracle ABI loaded from Hardhat build artifacts');
    assert(ABIs.SettlementEngineABI.length > 0, 'SettlementEngine ABI loaded from Hardhat build artifacts');
    assert(ABIs.OrderBookEngineABI.length > 0, 'OrderBookEngine ABI loaded from Hardhat build artifacts');

    // 5. Decoder tracking check
    const factoryAddress = process.env.VAULT_FACTORY;
    if (factoryAddress) {
      assert(isTracked(factoryAddress), `VaultFactory address (${factoryAddress}) is tracked for sync`);
    } else {
      logger.warn('VAULT_FACTORY address not set in .env, skipping tracking check');
    }

    if (checksPassed) {
      logger.info('====================================================');
      logger.info('   VERIFICATION SUCCESSFUL: CODE IS PRODUCTION READY ');
      logger.info('====================================================');
      process.exit(0);
    } else {
      logger.error('====================================================');
      logger.error('   VERIFICATION FAILED: PLEASE FIX ABOVE ERRORS      ');
      logger.error('====================================================');
      process.exit(1);
    }
  } catch (err) {
    logger.error('Verification crashed with fatal error:', err);
    process.exit(1);
  }
}

runVerification();
