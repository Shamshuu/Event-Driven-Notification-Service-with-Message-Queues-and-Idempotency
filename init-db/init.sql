CREATE DATABASE IF NOT EXISTS notifications_db;
USE notifications_db;

-- 1. Create processed_events table
CREATE TABLE IF NOT EXISTS processed_events (
    event_id VARCHAR(255) PRIMARY KEY,
    status VARCHAR(50) NOT NULL, -- e.g., 'PROCESSING', 'COMPLETED', 'FAILED', 'PENDING'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Create notification_logs table
CREATE TABLE IF NOT EXISTS notification_logs (
    log_id INT AUTO_INCREMENT PRIMARY KEY,
    event_id VARCHAR(255) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    message_payload JSON,
    status VARCHAR(50) NOT NULL, -- e.g., 'SENT', 'FAILED_EXTERNAL', 'DLQ_MOVED'
    processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES processed_events(event_id)
);

-- 3. Seed tables with an initial audit record to verify connections and schema validation
INSERT IGNORE INTO processed_events (event_id, status) 
VALUES ('00000000-0000-0000-0000-000000000000', 'COMPLETED');

INSERT IGNORE INTO notification_logs (event_id, recipient, type, message_payload, status) 
VALUES ('00000000-0000-0000-0000-000000000000', 'seed-recipient@test.com', 'email', '{"subject":"DB Seed Event","body":"Verifying system boot"}', 'SENT');
