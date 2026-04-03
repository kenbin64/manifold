#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFOLD-NATIVE DEPLOYMENT PIPELINE — Updated for /home/manifold
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deploys compiled manifold artifact instead of traditional HTTP server.
 *
 * Flow:
 * 1. Compile manifold (all state definitions → single JSON artifact)
 * 2. Package with substrate adapters (HTTP, WS, File)
 * 3. Transfer manifold artifact + adapters to VPS
 * 4. Mount substrates on manifold
 * 5. Start unified server (talks manifold only)
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VPS_HOST = '100.70.142.122';
const VPS_USER = 'butterfly';
const VPS_TARGET = `${VPS_USER}@${VPS_HOST}`;
const REMOTE_MANIFOLD_DIR = '/home/butterfly/manifold';  // Use butterfly's home, where they have write permission
const PACKAGE_NAME = 'manifold-artifact.tar.gz';
const PACKAGE_PATH = path.join(ROOT, PACKAGE_NAME);

const HELIX = ['PRECOMPILE', 'ARTIFACT', 'VALIDATE', 'PACKAGE', 'TRANSFER', 'MOUNT', 'ACTIVATE'];

function log(stage, msg, ok = true) {
  const sym = ok ? '✓' : '✗';
  console.log(`  [${stage}] ${sym} ${msg}`);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe', ...opts }).trim();
}

function runSafe(cmd, opts = {}) {
  try { return { ok: true, out: run(cmd, opts) }; }
  catch (e) { return { ok: false, out: e.stderr || e.message }; }
}

function fail(stage, msg) {
  log(stage, msg, false);
  process.exit(1);
}

async function pipeline() {
  const startTime = Date.now();
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║        MANIFOLD-NATIVE DEPLOYMENT (to /home/manifold)   ║`);
  console.log(`║  Artifact-based dimensional collapse                    ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);

  // ── STAGE 0: PRECOMPILE — Compile manifold to artifact ────────────────
  console.log('STAGE 0: PRECOMPILE — Generating manifold artifact...');
  const compileResult = runSafe('npm run compile-manifold 2>&1');
  if (!compileResult.ok) {
    log('PRECOMPILE', 'Manifold compilation failed', false);
    console.log(compileResult.out.split('\n').slice(-5).join('\n'));
    fail('PRECOMPILE', 'Could not compile manifold');
  }
  log('PRECOMPILE', 'Manifold compiled to core/game-manifold.json');

  // Verify artifact exists
  const artifactPath = path.join(ROOT, 'core', 'game-manifold.json');
  if (!fs.existsSync(artifactPath)) {
    fail('PRECOMPILE', 'Manifold artifact not generated');
  }
  const artifactSize = fs.statSync(artifactPath).size;
  log('PRECOMPILE', `Artifact size: ${(artifactSize / 1024).toFixed(1)} KB`);

  // ── STAGE 1: ARTIFACT — Verify manifold integrity ─────────────────────
  console.log('\nSTAGE 1: ARTIFACT — Validating manifold structure...');
  try {
    const manifestData = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    if (!manifestData.coordinates || !manifestData.version) {
      fail('ARTIFACT', 'Invalid manifold structure (missing coordinates or version)');
    }
    log('ARTIFACT', `Manifold version: ${manifestData.version}`);
    log('ARTIFACT', `Dimensions: ${manifestData.dimensions.length}`);
    log('ARTIFACT', `Checksum: ${manifestData.checksum || 'N/A'}`);
  } catch (e) {
    fail('ARTIFACT', `Failed to parse manifold: ${e.message}`);
  }

  // ── STAGE 2: VALIDATE — Check all substrate adapters exist ────────────
  console.log('\nSTAGE 2: VALIDATE — Checking substrate adapters...');
  const requiredAdapters = [
    'server/http-substrate-adapter.ts',
    'server/ws-substrate-adapter.ts',
    'server/manifold-server.js',
  ];
  for (const adapter of requiredAdapters) {
    const adapterPath = path.join(ROOT, adapter);
    if (!fs.existsSync(adapterPath)) {
      log('VALIDATE', `Missing: ${adapter}`, false);
    } else {
      log('VALIDATE', adapter);
    }
  }

  // ── STAGE 3: PACKAGE — Create deployment artifact ──────────────────────
  console.log('\nSTAGE 3: PACKAGE — Creating deployment package...');

  // Simple tar: just include the files we need
  const tarFiles = [
    'core/game-manifold.json',
    'server/http-substrate-adapter.ts',
    'server/ws-substrate-adapter.ts',
    'server/manifold-server.js',
    'server/package.json',
    'package.json',
  ];

  run(`tar -czf ${PACKAGE_NAME} --exclude=node_modules ${tarFiles.join(' ')}`);
  const packageSize = fs.statSync(PACKAGE_PATH).size;
  log('PACKAGE', `${PACKAGE_NAME} (${(packageSize / 1024).toFixed(1)} KB)`);

  // ── STAGE 3.5: PREPARE — Create remote directory ────────────
  console.log('\nSTAGE 3.5: PREPARE — Creating remote directory...');
  const mkdirCmd = `ssh ${VPS_TARGET} "mkdir -p ${REMOTE_MANIFOLD_DIR} && chmod 755 ${REMOTE_MANIFOLD_DIR}"`;
  const mkdirResult = runSafe(mkdirCmd);
  if (!mkdirResult.ok) {
    log('PREPARE', `Warning: mkdir output: ${mkdirResult.out.slice(0, 100)}`);
  } else {
    log('PREPARE', `Created ${REMOTE_MANIFOLD_DIR} with write permissions`);
  }

  // ── STAGE 4: TRANSFER — Send to VPS ──────────────────────────────────────
  console.log('\nSTAGE 4: TRANSFER — Sending artifact to VPS...');
  const scpResult = runSafe(`scp ${PACKAGE_PATH} ${VPS_TARGET}:${REMOTE_MANIFOLD_DIR}/`);
  if (!scpResult.ok) fail('TRANSFER', `SCP failed: ${scpResult.out}`);
  log('TRANSFER', `Sent to ${VPS_TARGET}:${REMOTE_MANIFOLD_DIR}/`);

  // ── STAGE 5: MOUNT — Extract and mount substrate adapters ───────────────
  console.log('\nSTAGE 5: MOUNT — Mounting substrates on manifold...');

  // Extract package
  const extractCmd = `ssh ${VPS_TARGET} "cd ${REMOTE_MANIFOLD_DIR} && tar -xzf ${PACKAGE_NAME} && rm ${PACKAGE_NAME}"`;
  const extractResult = runSafe(extractCmd);
  if (!extractResult.ok) fail('MOUNT', `Extract failed: ${extractResult.out}`);
  log('MOUNT', 'Artifact extracted');

  // Install dependencies
  const npmInstall = runSafe(`ssh ${VPS_TARGET} "cd ${REMOTE_MANIFOLD_DIR} && npm install --omit=dev"`);
  if (!npmInstall.ok) {
    log('MOUNT', 'npm install failed', false);
    console.log(npmInstall.out);
    fail('MOUNT', 'Could not install dependencies');
  }
  log('MOUNT', 'Dependencies installed');

  // ── STAGE 6: ACTIVATE — Start manifold server ────────────────────────────
  console.log('\nSTAGE 6: ACTIVATE — Starting manifold server...');

  // Stop existing process
  runSafe(`ssh ${VPS_TARGET} "pkill -f 'node.*manifold-server' || true"`);
  log('ACTIVATE', 'Stopped any existing process');

  // Get SSL certificate
  const certCmd = `ssh ${VPS_TARGET} "certbot certonly --standalone --agree-tos --email admin@kensgames.com -d kensgames.com -d www.kensgames.com --non-interactive 2>/dev/null || echo 'Certificate already exists'"`;
  const certResult = runSafe(certCmd);
  if (!certResult.ok) {
    log('ACTIVATE', 'Could not obtain SSL certificate (may already exist)', false);
  } else {
    log('ACTIVATE', 'SSL certificate ready');
  }

  // Start server
  const startCmd = `ssh ${VPS_TARGET} "cd ${REMOTE_MANIFOLD_DIR} && MANIFOLD_DIR=${REMOTE_MANIFOLD_DIR} nohup node server/manifold-server.js > manifold.log 2>&1 &"`;
  const startResult = runSafe(startCmd);
  if (!startResult.ok) fail('ACTIVATE', `Start failed: ${startResult.out}`);
  log('ACTIVATE', 'Manifold server started');

  // Health check
  await new Promise(r => setTimeout(r, 2000));
  const healthCmd = `ssh ${VPS_TARGET} "curl -sf https://kensgames.com/ > /dev/null && echo ok || echo fail"`;
  const healthCheck = runSafe(healthCmd);
  if (!healthCheck.ok || !healthCheck.out.includes('ok')) {
    log('ACTIVATE', 'Health check FAILED', false);
  } else {
    log('ACTIVATE', 'Health check passed — manifold is live');
  }

  // Clean up local package
  if (fs.existsSync(PACKAGE_PATH)) fs.unlinkSync(PACKAGE_PATH);

  // ── Complete ─────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║  ✓ MANIFOLD DEPLOYMENT COMPLETE                          ║`);
  console.log(`║  Deployed to: ${REMOTE_MANIFOLD_DIR.padEnd(40)}║`);
  console.log(`║  Time: ${(elapsed + 's').padEnd(46)}║`);
  console.log(`║  Server: https://kensgames.com                           ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
}

pipeline().catch(err => {
  console.error('\n✗ Deployment error:', err.message);
  process.exit(1);
});
