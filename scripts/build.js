#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('Building Claude Code Router (Monorepo)...');

try {
  // Build core package first (@caeliq/llms)
  console.log('Building core package (@caeliq/llms)...');
  execSync('node scripts/build-core.js', { stdio: 'inherit' });

  // Build shared package
  console.log('Building shared package...');
  execSync('node scripts/build-shared.js', { stdio: 'inherit' });

  // Build CLI package (which will also build server)
  console.log('Building CLI package (includes server)...');
  execSync('node scripts/build-cli.js', { stdio: 'inherit' });

  console.log('\n✅ Build completed successfully!');
  console.log('\nArtifacts are available in packages/*/dist:');
  console.log('  - packages/core/dist/     (Core package: @caeliq/llms)');
  console.log('  - packages/shared/dist/   (Shared package)');
  console.log('  - packages/cli/dist/      (CLI + tiktoken)');
  console.log('  - packages/server/dist/   (Server standalone)');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}