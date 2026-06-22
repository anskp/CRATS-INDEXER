import { createPublicClient, http, fallback } from 'viem';
import { sepolia } from 'viem/chains';
import logger from './logger.js';
import dotenv from 'dotenv';

dotenv.config();

const primaryRpc = process.env.SEPOLIA_RPC_URL;
const backupRpc = process.env.SEPOLIA_RPC_URL_BACKUP;

logger.info(`Initializing Viem client for Sepolia chain ID: ${sepolia.id}`);
logger.info(`Primary RPC URL: ${primaryRpc}`);
if (backupRpc) {
  logger.info(`Backup RPC URL configured`);
}

const transports = [];
if (primaryRpc) {
  transports.push(http(primaryRpc));
}
if (backupRpc) {
  transports.push(http(backupRpc));
}

// Fallback transport
const publicClient = createPublicClient({
  chain: sepolia,
  transport: fallback(transports, {
    rank: true, // Rank transports by response speed and health status
  }),
});

export default publicClient;
