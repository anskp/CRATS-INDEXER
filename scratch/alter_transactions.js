import prisma from '../src/config/db.js';

async function main() {
  try {
    console.log('Altering transactions table...');
    
    try {
      await prisma.$executeRawUnsafe('ALTER TABLE transactions ADD COLUMN gas_price BIGINT NULL');
      console.log('Successfully added gas_price column.');
    } catch (e) {
      console.log('gas_price column might already exist:', e.message);
    }
    
    try {
      await prisma.$executeRawUnsafe('ALTER TABLE transactions ADD COLUMN transaction_fee VARCHAR(255) NULL');
      console.log('Successfully added transaction_fee column.');
    } catch (e) {
      console.log('transaction_fee column might already exist:', e.message);
    }

    try {
      await prisma.$executeRawUnsafe('ALTER TABLE transactions ADD COLUMN gas_limit BIGINT NULL');
      console.log('Successfully added gas_limit column.');
    } catch (e) {
      console.log('gas_limit column might already exist:', e.message);
    }

    try {
      await prisma.$executeRawUnsafe('ALTER TABLE transactions ADD COLUMN token_name VARCHAR(255) NULL');
      console.log('Successfully added token_name column.');
    } catch (e) {
      console.log('token_name column might already exist:', e.message);
    }

    try {
      await prisma.$executeRawUnsafe('ALTER TABLE transactions ADD COLUMN token_symbol VARCHAR(50) NULL');
      console.log('Successfully added token_symbol column.');
    } catch (e) {
      console.log('token_symbol column might already exist:', e.message);
    }

    try {
      await prisma.$executeRawUnsafe('ALTER TABLE transactions ADD COLUMN token_amount VARCHAR(255) NULL');
      console.log('Successfully added token_amount column.');
    } catch (e) {
      console.log('token_amount column might already exist:', e.message);
    }
    
    console.log('Altering done!');
  } catch (error) {
    console.error('Error altering transactions table:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
