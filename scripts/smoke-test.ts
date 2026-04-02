/**
 * Smoke test script for the MC native agent runtime.
 * Run: npx tsx scripts/smoke-test.ts
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';

// Load .env manually (dotenv may not be available via npx tsx)
const envPath = resolve(import.meta.dirname || __dirname, '..', '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+?)=(.+)$/);
    if (match) process.env[match[1].trim()] = match[2].trim().replace(/^"(.*)"$/, '$1');
  }
} catch { /* .env not found, rely on existing env */ }

import { runAgentLoop } from '../src/lib/agent-runtime/agent-loop.js';

async function main() {
  const openclawHome = process.env.OPENCLAW_HOME;
  if (!openclawHome) throw new Error('OPENCLAW_HOME environment variable is not set');

  const config = {
    agentId: 'test-native',
    workspacePath: join(openclawHome, 'workspace-test-native'),
    providerPrimary: 'gemini',
    modelPrimary: 'gemini-2.5-flash',
    maxIterations: 3,
    temperature: 0.5,
  };

  const contextMessage = `MC Native Runtime Smoke Test.
Please:
1) Read your workspace README.md using the file_read tool
2) Write a brief journal entry using mc_journal saying the smoke test was successful
3) Then stop.`;

  console.log('🚀 Starting MC native runtime smoke test...');
  console.log(`   Agent: ${config.agentId}`);
  console.log(`   Provider: ${config.providerPrimary}/${config.modelPrimary}`);
  console.log(`   Workspace: ${config.workspacePath}`);
  console.log('');

  const result = await runAgentLoop(config, contextMessage, `smoke-${Date.now()}`);

  console.log('\n=== SMOKE TEST RESULT ===');
  console.log(`Status:     ${result.ok ? '✅ SUCCESS' : '❌ FAILED'}`);
  console.log(`Iterations: ${result.iterations}`);
  console.log(`Tool calls: ${result.toolCalls}`);
  console.log(`Tokens:     ${result.tokensSent} sent / ${result.tokensRecv} recv`);
  console.log(`Provider:   ${result.provider}/${result.model}`);
  if (result.error) console.log(`Error:      ${result.error}`);
  console.log(`\nResponse:\n${result.response?.slice(0, 500) || '(no response)'}`);

  process.exit(result.ok ? 0 : 1);
}

main();
