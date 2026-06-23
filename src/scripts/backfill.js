import 'dotenv/config';
import prisma from '../config/db.js';
import publicClient from '../config/viem.js';
import logger from '../config/logger.js';
import { isTracked, decodeLog, registerContract, initializeABIRegistry } from '../sync/eventDecoder.js';
import * as ABIs from '../config/contractABIs.js';
import { Decimal } from '@prisma/client/runtime/library.js';

const CHAIN_ID = Number(process.env.CHAIN_ID || 11155111);
const DEFAULT_START_BLOCK = BigInt(process.env.START_BLOCK || 11036800);
const CHUNK_SIZE = 2000n; // Scan 2000 blocks at a time to prevent gateway timeouts

// Helper to delay execution
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// RPC Request wrapper with exponential backoff for rate limits and timeouts
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
        logger.warn(`RPC Transient error / rate limit encountered: "${errorStr.substring(0, 80)}". Retrying in ${waitTime}ms... (Attempt ${attempt}/${retries})`);
        await sleep(waitTime);
        continue;
      }
      throw error;
    }
  }
}

async function main() {
  logger.info('====================================================');
  logger.info('   CRATS Blockchain Indexer - Fast Event Backfill   ');
  logger.info('====================================================');

  try {
    await prisma.$connect();
    initializeABIRegistry();

    // 1. Resolve starting list of contract addresses
    const staticAddresses = [
      process.env.IDENTITY_REGISTRY,
      process.env.IDENTITY_SBT,
      process.env.KYC_REGISTRY,
      process.env.COMPLIANCE_MODULE,
      process.env.TRAVEL_RULE_MODULE,
      process.env.INVESTOR_RIGHTS_REGISTRY,
      process.env.CIRCUIT_BREAKER,
      process.env.ASSET_FACTORY,
      process.env.ASSET_REGISTRY,
      process.env.REAL_ESTATE_PLUGIN,
      process.env.VAULT_FACTORY,
      process.env.YIELD_DISTRIBUTOR,
      process.env.USDC,
      process.env.USDT,
      process.env.FEE_ENGINE,
      process.env.NAV_ORACLE,
      process.env.PRICE_ORACLE,
      process.env.MARKETPLACE_FACTORY,
      process.env.ORDER_BOOK_ENGINE,
      process.env.SETTLEMENT_ENGINE,
      process.env.CLEARING_HOUSE,
      process.env.TIMELOCK,
      process.env.REDEMPTION_MANAGER
    ].filter(Boolean).map(a => a.toLowerCase());

    const addressesToQuery = new Set(staticAddresses);

    // Load any existing vaults in the DB to make sure they are in ABI registry and queried
    const existingVaults = await prisma.vault.findMany({ select: { vaultAddress: true, vaultType: true } });
    for (const v of existingVaults) {
      const cleanAddr = v.vaultAddress.toLowerCase();
      const abi = v.vaultType === 'SYNC' ? ABIs.SyncVaultABI : ABIs.AsyncVaultABI;
      const label = v.vaultType === 'SYNC' ? 'SyncVault' : 'AsyncVault';
      registerContract(cleanAddr, abi, label);
      addressesToQuery.add(cleanAddr);
    }

    const currentBlock = await callWithRetry(() => publicClient.getBlockNumber());
    logger.info(`Sepolia network block head: ${currentBlock}`);
    logger.info(`Scanning block range: ${DEFAULT_START_BLOCK} → ${currentBlock} for ${addressesToQuery.size} addresses`);

    // Update status to syncing
    await prisma.syncStatus.upsert({
      where: { chainId: CHAIN_ID },
      create: {
        chainId: CHAIN_ID,
        lastSyncedBlock: DEFAULT_START_BLOCK - 1n,
        latestBlock: currentBlock,
        progressPercentage: new Decimal(0),
        status: 'syncing'
      },
      update: { status: 'syncing', latestBlock: currentBlock }
    });

    let start = DEFAULT_START_BLOCK;

    while (start <= currentBlock) {
      let end = start + CHUNK_SIZE - 1n;
      if (end > currentBlock) end = currentBlock;

      const percent = ((Number(end - DEFAULT_START_BLOCK) / Number(currentBlock - DEFAULT_START_BLOCK)) * 100).toFixed(1);
      logger.info(`Scanning blocks ${start} → ${end} (${percent}% scanned, tracking ${addressesToQuery.size} addresses)...`);

      const logs = await callWithRetry(() => publicClient.getLogs({
        address: Array.from(addressesToQuery),
        fromBlock: start,
        toBlock: end
      }));

      if (logs.length > 0) {
        logger.info(`Found ${logs.length} logs in block range ${start} → ${end}`);

        // Group logs by block number so we can write block/transactions atomically
        const blockGroups = {};
        for (const log of logs) {
          const blockNum = Number(log.blockNumber);
          if (!blockGroups[blockNum]) blockGroups[blockNum] = [];
          blockGroups[blockNum].push(log);
        }

        // Process each block sequentially
        const blockNums = Object.keys(blockGroups).map(Number).sort((a, b) => a - b);
        for (const blockNum of blockNums) {
          const blockLogs = blockGroups[blockNum];
          logger.info(`Processing block #${blockNum} with ${blockLogs.length} events...`);

          // Fetch block details
          const blockData = await callWithRetry(() => publicClient.getBlock({
            blockNumber: BigInt(blockNum),
            includeTransactions: true
          }));

          // Fetch receipts of only the transactions that emitted our logs
          const txHashes = Array.from(new Set(blockLogs.map(l => l.transactionHash)));
          const receipts = {};

          for (const txHash of txHashes) {
            const receipt = await callWithRetry(() => publicClient.getTransactionReceipt({ hash: txHash }));
            receipts[txHash] = {
              status: receipt.status === 'success' ? 'SUCCESS' : 'REVERTED',
              gasUsed: receipt.gasUsed,
              gasPrice: receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice) : 0n,
              logs: receipt.logs
            };
          }

          // Save block, transactions, logs and events atomically
          await prisma.$transaction(async (tx) => {
            // 1. Create Block record
            await tx.block.upsert({
              where: { blockNumber: BigInt(blockNum) },
              create: {
                blockNumber: BigInt(blockNum),
                blockHash: blockData.hash,
                parentHash: blockData.parentHash,
                timestamp: new Date(Number(blockData.timestamp) * 1000),
                gasUsed: blockData.gasUsed,
                txCount: blockData.transactions.length
              },
              update: {
                blockHash: blockData.hash,
                parentHash: blockData.parentHash,
                timestamp: new Date(Number(blockData.timestamp) * 1000)
              }
            });

            // 1b. Create IndexedBlock record
            await tx.indexedBlock.upsert({
              where: { blockNumber: BigInt(blockNum) },
              create: {
                blockNumber: BigInt(blockNum),
                blockHash: blockData.hash,
                parentHash: blockData.parentHash,
                status: 'synced'
              },
              update: {
                blockHash: blockData.hash,
                parentHash: blockData.parentHash,
                status: 'synced'
              }
            });

            // 2. Save Transactions and Logs
            for (const txHash of txHashes) {
              const rawTx = blockData.transactions.find(t => t.hash === txHash);
              if (!rawTx) continue;

              const receipt = receipts[txHash];
              const gasPrice = receipt.gasPrice || rawTx.gasPrice || 0n;
              const transactionFee = (receipt.gasUsed * gasPrice).toString();
              const gasLimit = rawTx.gas ? BigInt(rawTx.gas) : null;

              let tokenName = null;
              let tokenSymbol = null;
              let tokenAmount = null;

              for (const log of receipt.logs) {
                if (isTracked(log.address)) {
                  const decoded = decodeLog(log);
                  if (decoded && ['Transfer', 'Deposit', 'Withdraw'].includes(decoded.eventName)) {
                    const cleanAddr = log.address.toLowerCase();
                    if (cleanAddr === process.env.USDC?.toLowerCase()) {
                      tokenName = 'USD Coin';
                      tokenSymbol = 'USDC';
                    } else if (cleanAddr === process.env.USDT?.toLowerCase()) {
                      tokenName = 'Tether USD';
                      tokenSymbol = 'USDT';
                    } else {
                      const dbVault = await tx.vault.findUnique({
                        where: { vaultAddress: cleanAddr }
                      });
                      if (dbVault) {
                        tokenName = dbVault.name;
                        tokenSymbol = dbVault.symbol;
                      } else {
                        tokenName = decoded.contractLabel || 'Unknown Vault';
                        tokenSymbol = decoded.contractLabel || 'VAULT';
                      }
                    }

                    if (decoded.args) {
                      const rawAmount = decoded.args.value || decoded.args.shares || decoded.args.amount || decoded.args.assets;
                      if (rawAmount !== undefined && rawAmount !== null) {
                        tokenAmount = rawAmount.toString();
                      }
                    }
                    break;
                  }
                }
              }

              // Save Transaction
              await tx.transaction.upsert({
                where: { txHash },
                create: {
                  txHash,
                  blockNumber: BigInt(blockNum),
                  fromAddress: rawTx.from.toLowerCase(),
                  toAddress: rawTx.to ? rawTx.to.toLowerCase() : null,
                  contractAddress: rawTx.to ? null : (rawTx.contractAddress || null),
                  method: rawTx.input && rawTx.input !== '0x' ? rawTx.input.substring(0, 10) : 'Transfer',
                  status: receipt.status,
                  gasUsed: receipt.gasUsed,
                  gasLimit,
                  value: rawTx.value.toString(),
                  gasPrice,
                  transactionFee,
                  tokenName,
                  tokenSymbol,
                  tokenAmount,
                  timestamp: new Date(Number(blockData.timestamp) * 1000)
                },
                update: {
                  status: receipt.status,
                  gasUsed: receipt.gasUsed,
                  tokenName,
                  tokenSymbol,
                  tokenAmount
                }
              });

              // Save Logs & Events
              for (const log of receipt.logs) {
                await tx.log.upsert({
                  where: {
                    txHash_logIndex: {
                      txHash: log.transactionHash,
                      logIndex: log.logIndex
                    }
                  },
                  create: {
                    txHash: log.transactionHash,
                    logIndex: log.logIndex,
                    address: log.address.toLowerCase(),
                    topics: JSON.stringify(log.topics),
                    data: log.data,
                    blockNumber: BigInt(blockNum)
                  },
                  update: {
                    address: log.address.toLowerCase(),
                    topics: JSON.stringify(log.topics),
                    data: log.data
                  }
                });

                if (isTracked(log.address)) {
                  const decoded = decodeLog(log);
                  if (decoded) {
                    const eventPayload = JSON.stringify(decoded.args, (k, v) => 
                      typeof v === 'bigint' ? v.toString() : v
                    );

                    await tx.blockchainEvent.upsert({
                      where: {
                        txHash_logIndex: {
                          txHash: log.transactionHash,
                          logIndex: log.logIndex
                        }
                      },
                      create: {
                        chainId: CHAIN_ID,
                        blockNumber: BigInt(blockNum),
                        blockHash: blockData.hash,
                        parentHash: blockData.parentHash,
                        txHash: log.transactionHash,
                        logIndex: log.logIndex,
                        contractAddress: log.address,
                        eventName: decoded.eventName,
                        eventPayload,
                        status: 'pending',
                        isRemoved: false
                      },
                      update: {
                        eventName: decoded.eventName,
                        eventPayload,
                        status: 'pending',
                        isRemoved: false
                      }
                    });

                    logger.info(`   - Decoded and Ingested: ${decoded.eventName}`);

                    // Dynamic vault discovery
                    if (decoded.eventName === 'VaultCreated') {
                      const vaultAddress = (decoded.args.vault || decoded.args.vaultAddress)?.toLowerCase();
                      const vaultTypeRaw = decoded.args.vaultType;
                      if (vaultAddress && !addressesToQuery.has(vaultAddress)) {
                        logger.info(`   * Discovered new vault dynamically: ${vaultAddress}`);
                        const abi = vaultTypeRaw === 0 ? ABIs.SyncVaultABI : ABIs.AsyncVaultABI;
                        const label = vaultTypeRaw === 0 ? 'SyncVault' : 'AsyncVault';
                        registerContract(vaultAddress, abi, label);
                        addressesToQuery.add(vaultAddress);

                        // Mini-scan the newly discovered vault for the remainder of this chunk
                        if (BigInt(blockNum) < end) {
                          logger.info(`   * Mini-scanning new vault ${vaultAddress} from block ${blockNum} to ${end}...`);
                          const miniLogs = await callWithRetry(() => publicClient.getLogs({
                            address: vaultAddress,
                            fromBlock: BigInt(blockNum),
                            toBlock: end
                          }));
                          if (miniLogs.length > 0) {
                            logger.info(`   * Found ${miniLogs.length} additional logs for dynamic vault ${vaultAddress}`);
                            for (const miniLog of miniLogs) {
                              const miniBlockNum = Number(miniLog.blockNumber);
                              if (miniBlockNum > blockNum) {
                                if (!blockGroups[miniBlockNum]) {
                                  blockGroups[miniBlockNum] = [];
                                }
                                const exists = blockGroups[miniBlockNum].some(l => l.transactionHash === miniLog.transactionHash && l.logIndex === miniLog.logIndex);
                                if (!exists) {
                                  blockGroups[miniBlockNum].push(miniLog);
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          });
        }
      }

      // Update progress status occasionally
      if (start % (CHUNK_SIZE * 5n) === 0n || start + CHUNK_SIZE > currentBlock) {
        await prisma.syncStatus.update({
          where: { chainId: CHAIN_ID },
          data: {
            lastSyncedBlock: end,
            progressPercentage: new Decimal(percent),
            latestBlock: currentBlock
          }
        });
      }

      start = end + 1n;
      // Pause 100ms between calls to avoid rate limiting
      await sleep(100);
    }

    // Set sync status to completed and index status to chain head
    await prisma.syncStatus.update({
      where: { chainId: CHAIN_ID },
      data: {
        lastSyncedBlock: currentBlock,
        progressPercentage: new Decimal('100.00'),
        status: 'completed'
      }
    });
    // Seed/Update SyncMetric
    await prisma.syncMetric.upsert({
      where: { metricName: 'current_indexed_block' },
      create: { metricName: 'current_indexed_block', metricValue: currentBlock.toString() },
      update: { metricValue: currentBlock.toString() }
    });

    logger.info('====================================================');
    logger.info('   CRATS Blockchain Explorer - Backfill Completed   ');
    logger.info('====================================================');
  } catch (error) {
    logger.error('Backfill terminated due to error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
