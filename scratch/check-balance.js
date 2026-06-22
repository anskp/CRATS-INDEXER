import { formatEther } from 'viem';
import publicClient from '../src/config/viem.js';
import logger from '../src/config/logger.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  const address = "0x5537dbc19eeE936A615B151c8C5983FBF735C583";
  try {
    const balance = await publicClient.getBalance({ address });
    const formatted = formatEther(balance);
    logger.info(`Deployer Address: ${address}`);
    logger.info(`Sepolia Balance: ${formatted} ETH`);
    
    const blockNumber = await publicClient.getBlockNumber();
    logger.info(`Current Chain Head Block Number: ${blockNumber}`);
  } catch (err) {
    logger.error('Failed to get balance or connect to Sepolia:', err);
  }
}

main();
