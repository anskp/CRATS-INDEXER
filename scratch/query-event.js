import prisma from '../src/config/db.js';

async function main() {
  try {
    console.log("Resetting SyncStatus lastSyncedBlock to 11115300...");
    const updated = await prisma.syncStatus.update({
      where: { chainId: 11155111 },
      data: {
        lastSyncedBlock: 11115300n,
        status: 'idle',
        progressPercentage: 0
      }
    });
    console.log("SyncStatus reset successfully:", JSON.stringify(updated, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  } catch (error) {
    console.error("Error resetting sync status:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
