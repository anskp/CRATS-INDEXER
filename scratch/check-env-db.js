import prisma from '../src/config/db.js';

async function main() {
  try {
    await prisma.vault.delete({
      where: { id: 3 }
    });
    console.log('Successfully deleted temporary vault.');
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
