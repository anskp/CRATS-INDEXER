import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const events = await prisma.blockchainEvent.groupBy({
  by: ['eventName', 'contractAddress'],
  where: { isRemoved: false },
  _count: { eventName: true },
  orderBy: { _count: { eventName: 'desc' } },
  take: 60
});
console.log('=== ALL INDEXED EVENTS ===');
events.forEach(e => console.log(`${e._count.eventName.toString().padStart(5)} | ${e.eventName.padEnd(35)} | ${e.contractAddress}`));

const vaults = await prisma.vault.findMany({ select: { vaultAddress: true, name: true, symbol: true, vaultType: true, tvl: true, totalShares: true, category: true, creator: true } });
console.log('\n=== VAULTS IN DB ===');
vaults.forEach(v => console.log(JSON.stringify(v)));

const totalEvents = await prisma.blockchainEvent.count({ where: { isRemoved: false } });
console.log(`\nTotal events: ${totalEvents}`);

await prisma.$disconnect();
