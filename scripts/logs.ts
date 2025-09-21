#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const logsDir = path.join(__dirname, '..', 'logs');

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: Record<string, any>;
}

function listLogs(): void {
  if (!fs.existsSync(logsDir)) {
    console.log('No logs directory found.');
    return;
  }

  const files = fs.readdirSync(logsDir);
  if (files.length === 0) {
    console.log('No log files found.');
    return;
  }

  console.log('Available log files:');
  files.forEach(file => {
    const filePath = path.join(logsDir, file);
    const stats = fs.statSync(filePath);
    const size = (stats.size / 1024).toFixed(2);
    console.log(`  ${file} (${size} KB) - ${stats.mtime.toISOString()}`);
  });
}

function tailLog(filename: string, lines: number = 50): void {
  const filePath = path.join(logsDir, filename);
  
  if (!fs.existsSync(filePath)) {
    console.log(`Log file ${filename} not found.`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const logLines = content.split('\n').filter(line => line.trim());
  const tailLines = logLines.slice(-lines);
  
  console.log(`\nLast ${lines} lines of ${filename}:`);
  console.log('='.repeat(50));
  tailLines.forEach(line => {
    try {
      const logEntry: LogEntry = JSON.parse(line);
      const timestamp = new Date(logEntry.timestamp).toLocaleString();
      console.log(`[${timestamp}] ${logEntry.level.toUpperCase()}: ${logEntry.message}`);
      if (logEntry.meta && Object.keys(logEntry.meta).length > 0) {
        console.log(`  Metadata: ${JSON.stringify(logEntry.meta, null, 2)}`);
      }
    } catch (e) {
      console.log(line);
    }
  });
}

function clearLogs(): void {
  if (!fs.existsSync(logsDir)) {
    console.log('No logs directory found.');
    return;
  }

  const files = fs.readdirSync(logsDir);
  files.forEach(file => {
    const filePath = path.join(logsDir, file);
    fs.unlinkSync(filePath);
    console.log(`Deleted: ${file}`);
  });
  console.log('All log files cleared.');
}

// Command line interface
const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case 'list':
    listLogs();
    break;
  case 'tail':
    const filename = arg || `combined-${new Date().toISOString().split('T')[0]}.log`;
    const lines = parseInt(process.argv[4] || '50');
    tailLog(filename, lines);
    break;
  case 'clear':
    clearLogs();
    break;
  default:
    console.log('Log management script');
    console.log('Usage:');
    console.log('  npx ts-node scripts/logs.ts list                    - List all log files');
    console.log('  npx ts-node scripts/logs.ts tail [filename] [lines] - Show last N lines of log file');
    console.log('  npx ts-node scripts/logs.ts clear                   - Clear all log files');
    console.log('');
    console.log('Examples:');
    console.log('  npx ts-node scripts/logs.ts tail combined-2024-01-15.log 100');
    console.log('  npx ts-node scripts/logs.ts tail error-2024-01-15.log');
    break;
}
