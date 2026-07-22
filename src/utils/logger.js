import winston from 'winston';
import { config } from '../config/index.js';

const logger = winston.createLogger({
  level: config.nodeEnv === 'test' ? 'error' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      silent: config.nodeEnv === 'test' // suppress console logs during testing unless needed
    })
  ]
});

export default logger;
