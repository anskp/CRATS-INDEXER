import prisma from '../src/config/db.js';

async function main() {
  try {
    console.log('Altering logs.data column...');
    await prisma.$executeRawUnsafe('ALTER TABLE logs MODIFY data LONGTEXT');
    console.log('Successfully altered logs.data column to LONGTEXT!');
  } catch (error) {
    console.error('Error altering column:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
