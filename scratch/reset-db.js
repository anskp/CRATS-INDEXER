import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Resetting indexer tables...");
  await prisma.deadLetterEvent.deleteMany();
  await prisma.processedEvent.deleteMany();
  await prisma.blockchainEvent.deleteMany();
  await prisma.portfolioPosition.deleteMany();
  await prisma.feeRecord.deleteMany();
  await prisma.settlement.deleteMany();
  await prisma.navSubmission.deleteMany();
  await prisma.tokenHolder.deleteMany();
  await prisma.vault.deleteMany();
  await prisma.protocolMetric.deleteMany();
  await prisma.log.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.block.deleteMany();
  await prisma.indexedBlock.deleteMany();
  await prisma.syncStatus.deleteMany();
  await prisma.failedBlock.deleteMany();
  await prisma.syncMetric.deleteMany();
  console.log("Database indexer tables cleared successfully.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
