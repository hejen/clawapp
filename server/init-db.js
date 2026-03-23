#!/usr/bin/env node
/**
 * Database initialization script for OpenClaw Chat
 * Creates the database file and sets up all tables
 */

import { Database } from './db.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'data', 'chat.db');

console.log('Initializing database...');
console.log(`Database path: ${dbPath}`);

const db = new Database(dbPath);

try {
  await db.init();
  console.log('✓ Database initialized successfully');
  console.log('✓ All tables and indexes created');
  await db.close();
  console.log('✓ Database connection closed');
  process.exit(0);
} catch (error) {
  console.error('✗ Failed to initialize database:', error.message);
  process.exit(1);
}
