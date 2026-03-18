#!/usr/bin/env tsx
/**
 * Trial Preflight CLI
 *
 * Run: npx tsx scripts/preflight.ts
 *
 * Checks readiness for the 48h autonomous trial and prints colored output.
 */

import { config } from 'dotenv';
config(); // Load .env before any imports that need it

import { runPreflight } from '../src/lib/trial-preflight';

const ICONS = {
  pass: '\x1b[32m✓\x1b[0m',  // green check
  fail: '\x1b[31m✗\x1b[0m',  // red x
  warn: '\x1b[33m⚠\x1b[0m',  // yellow warning
} as const;

async function main() {
  console.log('\n\x1b[1m48h Trial Preflight Checks\x1b[0m\n');

  const result = await runPreflight();

  for (const check of result.checks) {
    const icon = ICONS[check.status];
    console.log(`  ${icon} ${check.name}: ${check.message}`);
  }

  console.log('');

  if (result.ready) {
    console.log(`\x1b[32m\x1b[1m${result.summary}\x1b[0m`);
  } else {
    console.log(`\x1b[31m\x1b[1m${result.summary}\x1b[0m`);
  }

  console.log('');
  process.exit(result.ready ? 0 : 1);
}

main().catch((err) => {
  console.error('Preflight failed:', err);
  process.exit(1);
});
