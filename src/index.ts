#!/usr/bin/env node
import process from 'node:process';
import { parseArgs } from 'node:util';

import { serverVersion } from './config.js';
import { startHttpServer } from './http-native.js';
import { logError } from './observability.js';
import { startStdioServer } from './server.js';

function printUsage(): void {
  process.stdout.write(
    [
      'superfetch MCP server',
      '',
      'Usage:',
      '  superfetch [--stdio] [--help] [--version]',
      '',
      'Options:',
      '  --stdio    Run in stdio mode (no HTTP server).',
      '  --help     Show this help message.',
      '  --version  Show server version.',
      '',
    ].join('\n')
  );
}

const FORCE_EXIT_TIMEOUT_MS = 10_000;
let forcedExitTimer: NodeJS.Timeout | undefined;

function scheduleForcedExit(reason: string): void {
  if (forcedExitTimer) return;
  forcedExitTimer = setTimeout(() => {
    process.stderr.write(`${reason}; forcing exit.\n`);
    process.exit(1);
  }, FORCE_EXIT_TIMEOUT_MS);
  forcedExitTimer.unref();
}

let values: { stdio: boolean; help: boolean; version: boolean };
try {
  ({ values } = parseArgs({
    options: {
      stdio: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
    },
  }));
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Invalid arguments: ${message}\n\n`);
  printUsage();
  process.exit(1);
}

if (values.help) {
  printUsage();
  process.exit(0);
}

if (values.version) {
  process.stdout.write(`${serverVersion}\n`);
  process.exit(0);
}
const isStdioMode = values.stdio;
let isShuttingDown = false;

const shutdownHandlerRef: { current?: (signal: string) => Promise<void> } = {};

function shouldAttemptShutdown(): boolean {
  return !isShuttingDown && !isStdioMode && Boolean(shutdownHandlerRef.current);
}

function attemptShutdown(signal: string): void {
  if (!shutdownHandlerRef.current) return;
  isShuttingDown = true;
  process.stderr.write('Attempting graceful shutdown...\n');
  void shutdownHandlerRef.current(signal);
}

function registerHttpSignalHandlers(): void {
  process.once('SIGINT', () => {
    if (shouldAttemptShutdown()) attemptShutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    if (shouldAttemptShutdown()) attemptShutdown('SIGTERM');
  });
}

function handleFatalError(label: string, error: Error, signal: string): void {
  logError(label, error);
  process.stderr.write(`${label}: ${error.message}\n`);
  process.exitCode = 1;

  if (shouldAttemptShutdown()) {
    attemptShutdown(signal);
    scheduleForcedExit('Graceful shutdown timed out');
    return;
  }

  scheduleForcedExit('Fatal error without shutdown handler');
}

process.on('uncaughtException', (error) => {
  handleFatalError('Uncaught exception', error, 'UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  handleFatalError('Unhandled rejection', error, 'UNHANDLED_REJECTION');
});

try {
  if (isStdioMode) {
    await startStdioServer();
  } else {
    const { shutdown } = await startHttpServer();
    shutdownHandlerRef.current = shutdown;
    registerHttpSignalHandlers();
  }
} catch (error: unknown) {
  logError(
    'Failed to start server',
    error instanceof Error ? error : undefined
  );
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to start server: ${message}\n`);
  process.exitCode = 1;
  scheduleForcedExit('Startup failure');
}
