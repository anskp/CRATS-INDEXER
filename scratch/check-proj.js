import prisma from '../src/config/db.js';

async function main() {
  try {
    const vaults = await prisma.vault.findMany({});
    console.log(JSON.stringify(vaults, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
