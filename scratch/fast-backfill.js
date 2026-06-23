import 'dotenv/config';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import prisma from '../src/config/db.js';
import { isTracked, decodeLog, initializeABIRegistry, registerContract } from '../src/sync/eventDecoder.js';
import * as ABIs from '../src/config/contractABIs.js';

initializeABIRegistry();

const primaryRpc = process.env.SEPOLIA_RPC_URL;
const client = createPublicClient({ chain: sepolia, transport: http(primaryRpc) });

const START_BLOCK = 11036800n;
const CHAIN_ID = 11155111;

async function main() {
  console.log("Starting hyper-fast individual log-based backfill...");
  const currentBlock = await client.getBlockNumber();
  console.log(`Current block: ${currentBlock}`);

  // 1. Static contract addresses to sync
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

  const allTrackedAddresses = new Set(staticAddresses);
  const CHUNK_SIZE = 5000n;

  // We scan sequentially per address (or we can run them in parallel to be super fast)
  for (const address of allTrackedAddresses) {
    console.log(`Scanning logs for address ${address}...`);
    let start = START_BLOCK;
    
    while (start <= currentBlock) {
      let end = start + CHUNK_SIZE - 1n;
      if (end > currentBlock) end = currentBlock;

      try {
        const logs = await client.getLogs({
          address,
          fromBlock: start,
          toBlock: end
        });

        if (logs.length > 0) {
          console.log(`Found ${logs.length} logs for ${address} in block range ${start} → ${end}`);
          for (const log of logs) {
            const decoded = decodeLog(log);
            if (decoded) {
              console.log(` - Decoded: ${decoded.eventName} from ${decoded.contractLabel} in block ${log.blockNumber}`);
              
              // If it's a VaultCreated, dynamically add it to the tracked list
              if (decoded.eventName === 'VaultCreated') {
                const vaultAddress = (decoded.args.vault || decoded.args.vaultAddress)?.toLowerCase();
                const vaultTypeRaw = decoded.args.vaultType;
                if (vaultAddress && !allTrackedAddresses.has(vaultAddress)) {
                  console.log(`   * Discovered and added vault: ${vaultAddress}`);
                  const abi = vaultTypeRaw === 0 ? ABIs.SyncVaultABI : ABIs.AsyncVaultABI;
                  const label = vaultTypeRaw === 0 ? 'SyncVault' : 'AsyncVault';
                  registerContract(vaultAddress, abi, label);
                  allTrackedAddresses.add(vaultAddress);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error(`Error scanning logs for ${address} in range ${start} to ${end}: ${e.message}`);
      }

      start = end + 1n;
    }
  }

  console.log("Fast backfill check complete!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
