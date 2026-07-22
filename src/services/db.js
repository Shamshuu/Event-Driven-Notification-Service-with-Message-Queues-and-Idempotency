import mysql from 'mysql2/promise';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

let pool = null;

export function getDbPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000
    });
    logger.info('MySQL Connection Pool initialized', {
      host: config.db.host,
      port: config.db.port,
      database: config.db.database
    });
  }
  return pool;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('MySQL Connection Pool closed');
  }
}
