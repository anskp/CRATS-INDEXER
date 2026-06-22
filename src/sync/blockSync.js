import publicClient from '../config/viem.js';
import prisma from '../config/db.js';
import logger from '../config/logger.js';
import { isTracked, decodeLog, registerContract, initializeABIRegistry } from './eventDecoder.js';
import * as ABIs from '../config/contractABIs.js';

let isSyncing = false;
let syncTimeout = null;

export async function startSync() {
  logger.info('Starting Block Synchronization Service...');
  initializeABIRegistry();

  // Load existing vaults from database and register their ABIs
  try {
    const existingVaults = await prisma.vault.findMany({
      select: { vaultAddress: true, vaultType: true }
    });
    for (const vault of existingVaults) {
      const abi = vault.vaultType === 'SYNC' ? ABIs.SyncVaultABI : ABIs.AsyncVaultABI;
      const label = vault.vaultType === 'SYNC' ? 'SyncVault' : 'AsyncVault';
      registerContract(vault.vaultAddress, abi, label);
    }
  } catch (error) {
    logger.warn(`Could not load existing vaults from DB (database might not be initialized yet): ${error.message}`);
  }

  // Set up sync loop
  runSyncLoop();
}

async function runSyncLoop() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const lastBlockRecord = await prisma.indexedBlock.findFirst({
      orderBy: { blockNumber: 'desc' }
    });

    let nextBlockToSync = lastBlockRecord
      ? Number(lastBlockRecord.blockNumber) + 1
      : Number(process.env.START_BLOCK || 11484000);

    const currentBlock = Number(await publicClient.getBlockNumber());

    if (nextBlockToSync <= currentBlock) {
      logger.info(`Syncing block ${nextBlockToSync} / ${currentBlock} (${currentBlock - nextBlockToSync} blocks behind)`);
      
      const blockData = await publicClient.getBlock({
        blockNumber: BigInt(nextBlockToSync),
        includeTransactions: true
      });

      // Reorg Check
      if (lastBlockRecord && blockData.parentHash !== lastBlockRecord.blockHash) {
        logger.warn(`Reorganization detected at block ${nextBlockToSync - 1}! Expected parent hash: ${lastBlockRecord.blockHash}, Got: ${blockData.parentHash}`);
        await handleReorg(nextBlockToSync - 1);
        isSyncing = false;
        // Re-run immediately after recovery
        setTimeout(runSyncLoop, 500);
        return;
      }

      // Fetch receipts for all transactions in this block
      let receipts = {};
      if (blockData.transactions.length > 0) {
        try {
          const blockNumHex = '0x' + BigInt(nextBlockToSync).toString(16);
          const rawReceipts = await publicClient.request({
            method: 'eth_getBlockReceipts',
            params: [blockNumHex]
          });
          for (const receipt of rawReceipts) {
            receipts[receipt.transactionHash] = {
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
        } catch (error) {
          logger.warn(`eth_getBlockReceipts failed in blockSync for block ${nextBlockToSync}: ${error.message}. Falling back to individual queries.`);
          for (const tx of blockData.transactions) {
            try {
              const receipt = await publicClient.getTransactionReceipt({ hash: tx.hash });
              receipts[tx.hash] = {
                status: receipt.status === 'success' ? 'SUCCESS' : 'REVERTED',
                gasUsed: receipt.gasUsed,
                gasPrice: receipt.effectiveGasPrice ? BigInt(receipt.effectiveGasPrice) : 0n,
                logs: receipt.logs
              };
            } catch (err) {
              logger.error(`Failed to fetch receipt for tx ${tx.hash} in blockSync: ${err.message}`);
            }
          }
        }
      }

      // Process block data, transactions, logs and events
      await prisma.$transaction(async (tx) => {
        // 1. Insert/Update Block
        await tx.block.upsert({
          where: { blockNumber: BigInt(nextBlockToSync) },
          create: {
            blockNumber: BigInt(nextBlockToSync),
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

        // 2. Process transactions & logs
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

          // Save transaction
          await tx.transaction.upsert({
            where: { txHash: rawTx.hash },
            create: {
              txHash: rawTx.hash,
              blockNumber: BigInt(nextBlockToSync),
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

          // Save raw logs & events
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
                blockNumber: BigInt(nextBlockToSync)
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
                const eventPayload = serializeBigInts(decoded.args);
                await tx.blockchainEvent.upsert({
                  where: {
                    txHash_logIndex: {
                      txHash: log.transactionHash,
                      logIndex: log.logIndex
                    }
                  },
                  create: {
                    chainId: Number(process.env.CHAIN_ID || 11155111),
                    blockNumber: log.blockNumber,
                    blockHash: log.blockHash,
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
                    status: 'pending',
                    isRemoved: false,
                    blockNumber: log.blockNumber,
                    blockHash: log.blockHash,
                    parentHash: blockData.parentHash
                  }
                });

                logger.info(`Ingested event: ${decoded.eventName} from ${decoded.contractLabel} (${log.transactionHash} @ Log ${log.logIndex})`);

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

        // 3. Record block as indexed
        await tx.indexedBlock.upsert({
          where: { blockNumber: BigInt(nextBlockToSync) },
          create: {
            blockNumber: BigInt(nextBlockToSync),
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
      }, {
        timeout: 30000
      });

      // Update sync metrics
      await prisma.syncMetric.upsert({
        where: { metricName: 'current_indexed_block' },
        create: { metricName: 'current_indexed_block', metricValue: nextBlockToSync.toString() },
        update: { metricValue: nextBlockToSync.toString() }
      });
      await prisma.syncMetric.upsert({
        where: { metricName: 'chain_head_block' },
        create: { metricName: 'chain_head_block', metricValue: currentBlock.toString() },
        update: { metricValue: currentBlock.toString() }
      });

      isSyncing = false;
      // Proactively process next block immediately
      setTimeout(runSyncLoop, 100);
      return;
    }
  } catch (error) {
    logger.error(`Error in block sync loop:`, error);
  }

  isSyncing = false;
  // Sleep and check again
  syncTimeout = setTimeout(runSyncLoop, 2000);
}

/**
 * Handles chain reorganizations by backtracking block-by-block.
 */
async function handleReorg(reorgedBlockNumber) {
  logger.warn(`Recovering from reorg at block ${reorgedBlockNumber}...`);

  let ancestorBlockNumber = reorgedBlockNumber;
  let foundAncestor = false;

  while (ancestorBlockNumber >= Number(process.env.START_BLOCK || 11484000)) {
    const storedBlock = await prisma.indexedBlock.findUnique({
      where: { blockNumber: BigInt(ancestorBlockNumber) }
    });

    if (!storedBlock) {
      ancestorBlockNumber--;
      continue;
    }

    try {
      const rpcBlock = await publicClient.getBlock({
        blockNumber: BigInt(ancestorBlockNumber)
      });

      if (storedBlock.blockHash === rpcBlock.hash) {
        foundAncestor = true;
        break;
      }
    } catch (err) {
      logger.error(`Failed to fetch block ${ancestorBlockNumber} during reorg check: ${err.message}`);
    }

    ancestorBlockNumber--;
  }

  const commonAncestor = foundAncestor ? ancestorBlockNumber : Number(process.env.START_BLOCK || 11484000);
  logger.warn(`Common ancestor found at block: ${commonAncestor}`);

  // Rollback database records in transaction
  await prisma.$transaction([
    // Delete block indexing records
    prisma.indexedBlock.deleteMany({
      where: { blockNumber: { gt: BigInt(commonAncestor) } }
    }),
    // Mark events as removed
    prisma.blockchainEvent.updateMany({
      where: { blockNumber: { gt: BigInt(commonAncestor) } },
      data: { isRemoved: true, status: 'reorg_removed' }
    })
  ]);

  logger.info(`Ledger rolled back to block ${commonAncestor}. Projections will trigger full replay.`);

  // Reset projections to trigger replay to canonical head
  await resetAllProjections();
}

/**
 * Resets the projection states and truncates read models to force a clean replay.
 */
async function resetAllProjections() {
  logger.info('Resetting all projection states for recovery...');

  // Reset projection_state table
  await prisma.projectionState.updateMany({
    data: { lastEventId: 0n }
  });

  // Clear read models
  await prisma.portfolioPosition.deleteMany({});
  await prisma.vault.deleteMany({});
  await prisma.feeRecord.deleteMany({});
  await prisma.settlement.deleteMany({});
  await prisma.navSubmission.deleteMany({});
  await prisma.tokenHolder.deleteMany({});
  await prisma.protocolMetric.deleteMany({});

  logger.info('Read models cleared. Projections will rebuild from scratch.');
}

// Utility to serialize BigInts to string or number for json storage
function serializeBigInts(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serializeBigInts(v)])
    );
  }
  return value;
}

export function stopSync() {
  if (syncTimeout) clearTimeout(syncTimeout);
  isSyncing = false;
  logger.info('Block Synchronization Service stopped.');
}
