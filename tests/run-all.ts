import { runCloudflareTests } from './cloudflare-client.test';
import { runSmartposTests } from './smartpos-client.test';
import { runJobProcessorTests } from './job-processor.test';
import { runE2eTests } from './e2e-simulation.test';

console.log('\n======================================================');
console.log('🧪 RUNNING PLATORIA WINDOWS PRINT AGENT TEST SUITE');
console.log('======================================================\n');

async function run() {
  // 1. Synchronous unit test suites
  await import('./config.test');
  await import('./payload-validator.test');
  await import('./escpos.test');
  await import('./kot-formatter.test');
  await import('./logger.test');

  // 2. Asynchronous client & state machine test suites
  await runCloudflareTests();
  await runSmartposTests();
  await runJobProcessorTests();
  await runE2eTests();

  console.log('\n======================================================');
  console.log('🏁 ALL PRINT AGENT TEST SUITES PASSED (0 FAILURES)');
  console.log('======================================================\n');
}

run().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
