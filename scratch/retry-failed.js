import prisma from '../src/config/db.js';
import logger from '../src/config/logger.js';

async function main() {
  try {
    await prisma.$connect();
    
    // Find all failed events
    const failedEvents = await prisma.blockchainEvent.findMany({
      where: { status: 'failed' }
    });
    
    logger.info(`Found ${failedEvents.length} failed events to reset.`);
    
    if (failedEvents.length > 0) {
      const eventIds = failedEvents.map(e => e.eventId);
      
      // Delete processed events records for these events
      await prisma.processedEvent.deleteMany({
        where: { eventId: { in: eventIds } }
      });
      
      // Delete dead letter records
      await prisma.deadLetterEvent.deleteMany({
        where: { eventId: { in: eventIds } }
      });
      
      // Update status to pending
      await prisma.blockchainEvent.updateMany({
        where: { eventId: { in: eventIds } },
        data: { status: 'pending' }
      });
      
      logger.info(`Reset ${failedEvents.length} events back to 'pending'.`);
    }
  } catch (error) {
    logger.error('Failed to reset events:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
