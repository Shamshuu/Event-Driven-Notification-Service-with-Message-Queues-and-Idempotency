import { app } from './api/server.js';
import { getDbPool, closeDb } from './services/db.js';
import { initializeMq, closeMq } from './services/mq.js';
import { startConsumer } from './consumer/index.js';
import { config } from './config/index.js';
import logger from './utils/logger.js';

let server = null;

async function bootstrap() {
  try {
    logger.info('Bootstrapping Event-Driven Notification Service...');

    // 1. Initialize and verify DB connectivity
    const pool = getDbPool();
    await pool.query('SELECT 1');
    logger.info('Database connectivity verified.');

    // 2. Initialize MQ queues, exchanges, and dead-letter/retry loops
    await initializeMq();
    logger.info('RabbitMQ schema declarations completed.');

    // 3. Start HTTP API server
    server = app.listen(config.port, () => {
      logger.info(`HTTP Server listening on port ${config.port} [ENV: ${config.nodeEnv}]`);
    });

    // 4. Start subscribing to events
    await startConsumer();
    logger.info('Consumer subscriptions activated.');

  } catch (error) {
    logger.error('Critical failure during application bootstrap', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

async function handleShutdown(signal) {
  logger.info(`Graceful shutdown triggered by ${signal}.`);
  
  if (server) {
    server.close(() => {
      logger.info('HTTP Server stopped accepting new connections.');
    });
  }

  try {
    // Close MQ first to stop consuming new messages and finish in-flight ones
    await closeMq();
    // Close DB pool connections
    await closeDb();
    
    logger.info('Graceful shutdown completed successfully. Exiting.');
    process.exit(0);
  } catch (error) {
    logger.error('Exception during graceful shutdown sequence', { error: error.message });
    process.exit(1);
  }
}

// Register listeners for termination signals
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

bootstrap();
