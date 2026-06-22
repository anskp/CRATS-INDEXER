import prisma from '../src/config/db.js';

async function main() {
  try {
    const databases = await prisma.$queryRawUnsafe('SHOW DATABASES;');
    console.log('Databases:', JSON.stringify(databases, null, 2));
    
    const tables = await prisma.$queryRawUnsafe('SHOW TABLES;');
    console.log('Tables:', JSON.stringify(tables, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
