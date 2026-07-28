import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const bor = await prisma.beneficialOwnerRecord.findMany({});
  console.log(`BeneficialOwnerRecord count in indexer DB: ${bor.length}`);
  if (bor.length > 0) {
    console.log(JSON.stringify(bor, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
  }

  const logs = await prisma.p2pSettlementLog.findMany({});
  console.log(`\nP2pSettlementLog count in indexer DB: ${logs.length}`);
  if (logs.length > 0) {
    console.log(JSON.stringify(logs, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
  }
} catch (e) {
  console.error(e.message);
} finally {
  await prisma.$disconnect();
}
