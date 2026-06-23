import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Resetting projection-specific tables and event states...");
  
  // 1. Clear processed events and DLQ
  const d1 = await prisma.processedEvent.deleteMany();
  console.log(`Deleted ${d1.count} processed events records.`);
  
  const d2 = await prisma.deadLetterEvent.deleteMany();
  console.log(`Deleted ${d2.count} dead letter events.`);

  // 2. Clear all read models
  await prisma.portfolioPosition.deleteMany({});
  await prisma.vault.deleteMany({});
  await prisma.feeRecord.deleteMany({});
  await prisma.settlement.deleteMany({});
  await prisma.navSubmission.deleteMany({});
  await prisma.tokenHolder.deleteMany({});
  await prisma.protocolMetric.deleteMany({});
  console.log("Read models cleared.");

  // 3. Mark all blockchain events back to pending
  const u = await prisma.blockchainEvent.updateMany({
    data: { status: 'pending' }
  });
  console.log(`Marked ${u.count} blockchain events as pending for reprocessing.`);

  console.log("Reset completed successfully.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
