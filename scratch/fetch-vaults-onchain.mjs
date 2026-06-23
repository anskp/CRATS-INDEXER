import 'dotenv/config';
import { createPublicClient, http, decodeEventLog } from 'viem';
import { sepolia } from 'viem/chains';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const client = createPublicClient({ chain: sepolia, transport: http(process.env.RPC_URL) });
const prisma = new PrismaClient();

const VAULT_FACTORY = process.env.VAULT_FACTORY;

// Load actual ABI
const abiPath = path.resolve('../CRATS-EVM/artifacts/contracts/financial/VaultFactory.sol/VaultFactory.json');
const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8')).abi;

// Check what's in the DB
const dbVaults = await prisma.vault.findMany();
const dbEvents = await prisma.blockchainEvent.findMany({ 
  where: { eventName: 'VaultCreated' },
  orderBy: { blockNumber: 'asc' }
});
const syncedRange = await prisma.indexedBlock.aggregate({
  _min: { blockNumber: true },
  _max: { blockNumber: true }
});

console.log(`=== DB State ===`);
console.log(`Indexed block range: ${syncedRange._min.blockNumber} → ${syncedRange._max.blockNumber}`);
console.log(`Vaults in DB: ${dbVaults.length}`);
console.log(`VaultCreated events in blockchain_events: ${dbEvents.length}`);
dbVaults.forEach(v => console.log(` - ${v.name} (${v.symbol}) @ ${v.vaultAddress}`));

console.log(`\n=== On-Chain VaultCreated Events (full history in chunks) ===`);
const currentBlock = await client.getBlockNumber();

// Scan from block 11000000 to currentBlock in chunks of 1000 blocks
const vaultCreatedTopic = '0xdf3a94024ee1cee6a5c95943f049b64f07d619833b7c14d330a364ec7163700d';
let startBlock = 11000000n;
const CHUNK_SIZE = 1000n;

const vaultLogs = [];

while (startBlock <= currentBlock) {
  let endBlock = startBlock + CHUNK_SIZE - 1n;
  if (endBlock > currentBlock) {
    endBlock = currentBlock;
  }
  console.log(`Scanning blocks ${startBlock} to ${endBlock}...`);
  try {
    const logs = await client.getLogs({
      address: VAULT_FACTORY,
      event: abi.find(item => item.name === 'VaultCreated'),
      fromBlock: startBlock,
      toBlock: endBlock
    });
    vaultLogs.push(...logs);
  } catch (e) {
    console.error(`Error scanning blocks ${startBlock} to ${endBlock}: ${e.message}`);
  }
  startBlock = endBlock + 1n;
}

console.log(`\nTotal VaultCreated logs found on-chain: ${vaultLogs.length}`);

for (const log of vaultLogs) {
  try {
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
    console.log(`\nBlock ${log.blockNumber}: ${log.transactionHash}`);
    console.log(`  Vault:    ${decoded.args.vault}`);
    console.log(`  Asset:    ${decoded.args.asset}`);
    console.log(`  Type:     ${decoded.args.vaultType === 0 ? 'SYNC (0)' : 'ASYNC (1)'} [raw: ${decoded.args.vaultType}]`);
    console.log(`  Category: ${decoded.args.category}`);
    console.log(`  Creator:  ${decoded.args.creator}`);
    console.log(`  InDB: ${dbVaults.some(v => v.vaultAddress === decoded.args.vault?.toLowerCase()) ? 'YES' : 'NO ← MISSING'}`);
  } catch(e) {
    console.log(`  Decode error: ${e.message}`);
  }
}

await prisma.$disconnect();
