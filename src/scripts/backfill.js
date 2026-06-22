import 'dotenv/config';
import prisma from '../config/db.js';
import publicClient from '../config/viem.js';
import logger from '../config/logger.js';
import { isTracked, decodeLog, registerContract, initializeABIRegistry } from '../sync/eventDecoder.js';
import * as ABIs from '../config/contractABIs.js';
import { Decimal } from '@prisma/client/runtime/library.js';

// Configuration
const CHAIN_ID = Number(process.env.CHAIN_ID || 11155111);
const DEFAULT_START_BLOCK = BigInt(process.env.START_BLOCK || 11115300);
const BATCH_SIZE = 100; // Scan 100 blocks per batch
const CONCURRENCY_LIMIT = 5; // Max parallel RPC receipt calls

// Helper to delay execution
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to fetch transaction receipts with retry logic
async function fetchReceiptWithRetry(txHash, retries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
      return receipt;
    } catch (error) {
      if (attempt === retries) throw error;
      logger.warn(`Failed to fetch receipt for ${txHash} (Attempt ${attempt}/${retries}): ${error.message}`);
      await sleep(delayMs * attempt);
    }
  }
}

// Optimized block receipt fetcher using eth_getBlockReceipts with graceful fallback
async function fetchBlockReceipts(blockNum, transactions) {
  try {
    const blockNumHex = '0x' + blockNum.toString(16);
    const rawReceipts = await publicClient.request({
      method: 'eth_getBlockReceipts',
      params: [blockNumHex]
    });

    const results = {};
    for (const receipt of rawReceipts) {
      const txHash = receipt.transactionHash;
      results[txHash] = {
        status: receipt.status === '0x1' ? 'SUCCESS' : 'REVERTED',
        gasUsed: BigInt(receipt.gasUsed),
        gasPrice: receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice) : 0n,
        logs: (receipt.logs || []).map(log => ({
          ...log,
          logIndex: parseInt(log.logIndex, 16),
          blockNumber: BigInt(log.blockNumber)
        }))
      };
    }
    return results;
  } catch (error) {
    logger.warn(`eth_getBlockReceipts failed for block ${blockNum}: ${error.message}. Falling back to individual queries.`);
    const results = {};
    const queue = [...transactions];
    
    const worker = async () => {
      while (queue.length > 0) {
        const tx = queue.shift();
        if (!tx) break;
        try {
          const receipt = await fetchReceiptWithRetry(tx.hash);
          results[tx.hash] = {
            status: receipt.status === 'success' ? 'SUCCESS' : 'REVERTED',
            gasUsed: receipt.gasUsed,
            gasPrice: receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice) : 0n,
            logs: receipt.logs
          };
        } catch (err) {
          logger.error(`Permanent failure fetching receipt for tx ${tx.hash}: ${err.message}`);
          throw err;
        }
      }
    };

    // Start concurrent workers
    const workers = Array(Math.min(CONCURRENCY_LIMIT, transactions.length))
      .fill(null)
      .map(() => worker());

    await Promise.all(workers);
    return results;
  }
}

// Main backfill engine
async function main() {
  logger.info('====================================================');
  logger.info('   CRATS Blockchain Indexer - Starting Backfill    ');
  logger.info('====================================================');

  try {
    await prisma.$connect();
    initializeABIRegistry();

    // Load and register existing vaults
    const existingVaults = await prisma.vault.findMany({
      select: { vaultAddress: true, vaultType: true }
    });
    for (const vault of existingVaults) {
      const abi = vault.vaultType === 'SYNC' ? ABIs.SyncVaultABI : ABIs.AsyncVaultABI;
      const label = vault.vaultType === 'SYNC' ? 'SyncVault' : 'AsyncVault';
      registerContract(vault.vaultAddress, abi, label);
    }

    // Initialize or read sync status
    let syncRecord = await prisma.syncStatus.findUnique({
      where: { chainId: CHAIN_ID }
    });

    let startBlock = DEFAULT_START_BLOCK;
    if (syncRecord) {
      startBlock = syncRecord.lastSyncedBlock + 1n;
      logger.info(`Resuming backfill from block ${startBlock} (Last synced: ${syncRecord.lastSyncedBlock})`);
    } else {
      syncRecord = await prisma.syncStatus.create({
        data: {
          chainId: CHAIN_ID,
          lastSyncedBlock: DEFAULT_START_BLOCK - 1n,
          latestBlock: DEFAULT_START_BLOCK,
          progressPercentage: new Decimal(0),
          status: 'idle'
        }
      });
      logger.info(`Starting new backfill process from block ${startBlock}`);
    }

    // Get current network block head
    const latestBlock = await publicClient.getBlockNumber();
    logger.info(`Sepolia network block head: ${latestBlock}`);

    if (startBlock > latestBlock) {
      logger.info('Database is already fully synchronized to the blockchain head.');
      return;
    }

    // Update status to syncing
    await prisma.syncStatus.update({
      where: { chainId: CHAIN_ID },
      data: { status: 'syncing', latestBlock }
    });

    let currentBlock = startBlock;

    while (currentBlock <= latestBlock) {
      const batchEnd = currentBlock + BigInt(BATCH_SIZE) - 1n;
      const endOfRange = batchEnd > latestBlock ? latestBlock : batchEnd;

      logger.info(`Processing batch: blocks ${currentBlock} to ${endOfRange}...`);

      const blockQueue = [];
      for (let blockNum = currentBlock; blockNum <= endOfRange; blockNum++) {
        blockQueue.push(blockNum);
      }

      const processBlock = async (blockNum) => {
        let blockData = null;
        let receipts = {};

        try {
          // Fetch block with transactions
          blockData = await publicClient.getBlock({
            blockNumber: blockNum,
            includeTransactions: true
          });

          // Fetch receipts for all transactions in this block
          if (blockData.transactions.length > 0) {
            receipts = await fetchBlockReceipts(blockNum, blockData.transactions);
          }
        } catch (error) {
          logger.error(`Error processing block ${blockNum}: ${error.message}`);
          
          // Log failed block to failed_blocks table
          await prisma.failedBlock.upsert({
            where: { blockNumber: blockNum },
            create: {
              blockNumber: blockNum,
              error: error.message,
              retryCount: 1
            },
            update: {
              error: error.message,
              retryCount: { increment: 1 },
              timestamp: new Date()
            }
          });

          // Set sync status to error
          await prisma.syncStatus.update({
            where: { chainId: CHAIN_ID },
            data: { status: 'error' }
          });

          throw error;
        }

        // Commit block, transactions, logs, and events to database in a single transaction
        await prisma.$transaction(async (tx) => {
          // 1. Create Block record
          await tx.block.upsert({
            where: { blockNumber: blockNum },
            create: {
              blockNumber: blockNum,
              blockHash: blockData.hash,
              parentHash: blockData.parentHash,
              timestamp: new Date(Number(blockData.timestamp) * 1000),
              gasUsed: blockData.gasUsed,
              txCount: blockData.transactions.length
            },
            update: {
              blockHash: blockData.hash,
              parentHash: blockData.parentHash,
              timestamp: new Date(Number(blockData.timestamp) * 1000),
              gasUsed: blockData.gasUsed,
              txCount: blockData.transactions.length
            }
          });

           // 2. Process Transactions and Logs
          for (const rawTx of blockData.transactions) {
            const receipt = receipts[rawTx.hash] || { status: 'SUCCESS', gasUsed: 0n, gasPrice: 0n, logs: [] };
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
                  break; // Found the primary token operation log for this transaction
                }
              }
            }

            // Save Transaction
            await tx.transaction.upsert({
              where: { txHash: rawTx.hash },
              create: {
                txHash: rawTx.hash,
                blockNumber: blockNum,
                fromAddress: rawTx.from.toLowerCase(),
                toAddress: rawTx.to ? rawTx.to.toLowerCase() : null,
                contractAddress: rawTx.to ? null : (rawTx.contractAddress || null),
                method: rawTx.input && rawTx.input !== '0x' ? rawTx.input.substring(0, 10) : 'Transfer',
                status: receipt.status,
                gasUsed: receipt.gasUsed,
                gasLimit: gasLimit,
                value: rawTx.value.toString(),
                gasPrice: gasPrice,
                transactionFee: transactionFee,
                tokenName: tokenName,
                tokenSymbol: tokenSymbol,
                tokenAmount: tokenAmount,
                timestamp: new Date(Number(blockData.timestamp) * 1000)
              },
              update: {
                status: receipt.status,
                gasUsed: receipt.gasUsed,
                gasLimit: gasLimit,
                value: rawTx.value.toString(),
                gasPrice: gasPrice,
                transactionFee: transactionFee,
                tokenName: tokenName,
                tokenSymbol: tokenSymbol,
                tokenAmount: tokenAmount
              }
            });

            // Save Raw Logs and filter/decode for Ledger events
            for (const log of receipt.logs) {
              // Save raw log
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
                  blockNumber: blockNum
                },
                update: {
                  address: log.address.toLowerCase(),
                  topics: JSON.stringify(log.topics),
                  data: log.data
                }
              });

              // Check if the log is emitted by a tracked contract
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
                      blockNumber: blockNum,
                      blockHash: blockData.hash,
                      parentHash: blockData.parentHash,
                      txHash: log.transactionHash,
                      logIndex: log.logIndex,
                      contractAddress: log.address,
                      eventName: decoded.eventName,
                      eventPayload: eventPayload,
                      status: 'pending',
                      isRemoved: false
                    },
                    update: {
                      eventName: decoded.eventName,
                      eventPayload: eventPayload,
                      status: 'pending',
                      isRemoved: false
                    }
                  });

                  logger.info(`Ingested Backfill Event: ${decoded.eventName} from ${decoded.contractLabel} (${log.transactionHash} @ Log ${log.logIndex})`);

                  // Dynamic discovery of new vaults
                  if (decoded.eventName === 'VaultCreated') {
                    const vaultAddress = decoded.args.vault || decoded.args.vaultAddress;
                    const vaultTypeRaw = decoded.args.vaultType;
                    if (vaultAddress) {
                      const abi = vaultTypeRaw === 0 ? ABIs.SyncVaultABI : ABIs.AsyncVaultABI;
                      const label = vaultTypeRaw === 0 ? 'SyncVault' : 'AsyncVault';
                      registerContract(vaultAddress, abi, label);
                    }
                  }
                }
              }
            }
          }

          // Clear failure records if previously failed block is now indexed successfully
          await tx.failedBlock.deleteMany({
            where: { blockNumber: blockNum }
          });
        }, {
          timeout: 30000
        });
      };

      const blockWorker = async () => {
        while (blockQueue.length > 0) {
          const blockNum = blockQueue.shift();
          if (blockNum === undefined) break;
          await processBlock(blockNum);
        }
      };

      // Process blocks concurrently
      const BLOCK_CONCURRENCY = 5;
      const workers = Array(Math.min(BLOCK_CONCURRENCY, blockQueue.length))
        .fill(null)
        .map(() => blockWorker());

      await Promise.all(workers);

      // Update progress record at database level on batch completion
      const progress = latestBlock > DEFAULT_START_BLOCK 
        ? new Decimal(Number(endOfRange - DEFAULT_START_BLOCK + 1n) / Number(latestBlock - DEFAULT_START_BLOCK + 1n) * 100).toFixed(2)
        : '100.00';

      await prisma.syncStatus.update({
        where: { chainId: CHAIN_ID },
        data: {
          lastSyncedBlock: endOfRange,
          progressPercentage: new Decimal(progress),
          status: endOfRange >= latestBlock ? 'completed' : 'syncing'
        }
      });

      logger.info(`Batch complete! Synced up to block ${endOfRange} (${progress}% completed).`);
      currentBlock = endOfRange + 1n;
    }

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
