import dotenv from 'dotenv';

// Load .env file
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || 'rootpassword',
    database: process.env.DB_NAME || 'notifications_db',
  },

  mq: {
    host: process.env.MQ_HOST || 'localhost',
    port: parseInt(process.env.MQ_PORT || '5672', 10),
    user: process.env.MQ_USER || 'guest',
    password: process.env.MQ_PASS || 'guest',
    queueName: process.env.MQ_QUEUE_NAME || 'notification_events',
    exchangeName: process.env.MQ_EXCHANGE_NAME || 'notification_exchange',
    routingKey: process.env.MQ_ROUTING_KEY || 'notification_key',
    dlqName: process.env.MQ_DLQ_NAME || 'notification_dead_letter_queue',
  },

  retry: {
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    initialDelay: parseInt(process.env.RETRY_INITIAL_DELAY || '1000', 10),
    backoffFactor: parseInt(process.env.RETRY_BACKOFF_FACTOR || '5', 10),
  }
};
