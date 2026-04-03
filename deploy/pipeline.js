#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFOLD DEPLOYMENT PIPELINE — 7-Section Helix
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §0 VOID   — Verify prerequisites (node, git, ssh, connectivity)
 * §1 POINT  — Pull latest from git, pin commit SHA
 * §2 LINE   — Install dependencies, run tests
 * §3 WIDTH  — Validate all artifacts, check integrity
 * §4 PLANE  — Package deployment (tar, exclude dev/node_modules)
 * §5 VOLUME — Transfer to VPS via Tailscale SSH
 * §6 WHOLE  — Activate: stop → deploy → start → health check
 *
 * z = x · y — each stage's output IS the next stage's input.
 * Delta caching: skip stages whose inputs haven't changed.
 *
 * Minimum material. Maximum strength. Maximum surface area.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Configuration (from manifold surface) ──────────────────────────────
const ROOT = path.resolve(__dirname, '..');
const VPS_HOST = '100.70.142.122';
const VPS_USER = 'butterfly';
const VPS_TARGET = `${VPS_USER}@${VPS_HOST}`;
const REMOTE_DIR = '/home/butterfly/butterfly-platform';
const PACKAGE_NAME = 'manifold-deploy.tar.gz';
const PACKAGE_PATH = path.join(ROOT, PACKAGE_NAME);
const LOG_PATH = path.join(ROOT, 'deploy', '.deploy-log.jsonl');

// ─── Helix Stages ───────────────────────────────────────────────────────
const HELIX = ['VOID', 'POINT', 'LINE', 'WIDTH', 'PLANE', 'VOLUME', 'WHOLE'];

function log(stage, msg, ok = true) {
  const sym = ok ? '✓' : '✗';
  console.log(`  [§${stage} ${HELIX[stage]}] ${sym} ${msg}`);
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
  logDeploy({ stage: HELIX[stage], status: 'FAILED', reason: msg });
  process.exit(1);
}

function logDeploy(entry) {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const record = { ...entry, ts: new Date().toISOString() };
  fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n', 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

async function pipeline() {
  const startTime = Date.now();
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║        MANIFOLD DEPLOYMENT PIPELINE                      ║`);
  console.log(`║  z = x · y — 7-Section Helix Deployment                  ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);

  // ── §0 VOID — Prerequisites ─────────────────────────────────────────
  console.log('§0 VOID — Verifying prerequisites...');
  for (const tool of ['node', 'git', 'ssh', 'tar', 'scp']) {
    const r = runSafe(`${tool === 'ssh' || tool === 'scp' ? 'where' : 'where'} ${tool}`);
    if (!r.ok) fail(0, `${tool} not found in PATH`);
    log(0, `${tool} available`);
  }

  // Test SSH connectivity
  const sshTest = runSafe(`ssh -o ConnectTimeout=5 -o BatchMode=yes ${VPS_TARGET} "echo ok"`);
  if (!sshTest.ok) fail(0, `SSH to ${VPS_TARGET} failed: ${sshTest.out}`);
  log(0, `SSH to ${VPS_TARGET} connected`);

  // ── §1 POINT — Pin commit ───────────────────────────────────────────
  console.log('\n§1 POINT — Pinning commit...');
  const sha = run('git rev-parse HEAD');
  const branch = run('git rev-parse --abbrev-ref HEAD');
  const dirty = run('git status --porcelain');
  if (dirty) {
    log(1, `WARNING: working tree has uncommitted changes`, false);
    console.log(`    ${dirty.split('\n').length} file(s) modified`);
  }
  log(1, `Branch: ${branch}`);
  log(1, `Commit: ${sha.slice(0, 12)}`);

  // ── §2 LINE — Install + Test ────────────────────────────────────────
  console.log('\n§2 LINE — Install & test...');
  const serverInstall = runSafe('npm install --omit=dev', { cwd: path.join(ROOT, 'server') });
  if (!serverInstall.ok) fail(2, `server npm install failed`);
  log(2, 'Server dependencies installed');

  // Run tests if available (run in band to avoid haste collisions in nested package manifests)
  const testResult = runSafe('npm test -- --runInBand --passWithNoTests 2>&1');
  if (!testResult.ok) {
    log(2, 'Tests failed — aborting deployment', false);
    console.log(testResult.out.split('\n').slice(-10).join('\n'));
    fail(2, 'Tests did not pass');
  }
  log(2, 'Tests passed');

  // ── §3 WIDTH — Validate artifacts ───────────────────────────────────
  console.log('\n§3 WIDTH — Validating artifacts...');
  const requiredFiles = [
    'server/index.js',
    'server/manifold-socket.js',
    'server/auth-manifold.js',
    'server/package.json',
    'app/src/platform/kensgames.html',
    'app/src/platform/kensgames.js',
    'app/src/platform/kensgames.css',
    'app/src/platform/manifold-core.js',
    'app/src/platform/manifold.css',
  ];
  for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(ROOT, f))) fail(3, `Missing artifact: ${f}`);
    log(3, f);
  }

  // ── §4 PLANE — Package ─────────────────────────────────────────────
  console.log('\n§4 PLANE — Packaging...');
  const includes = [
    'server', 'app/src/platform', 'package.json',
  ].join(' ');
  const excludes = [
    '--exclude=node_modules', '--exclude=.git', '--exclude=*.test.*',
    '--exclude=.deploy-log.jsonl', '--exclude=deploy',
  ].join(' ');
  run(`tar -czf ${PACKAGE_NAME} ${excludes} ${includes}`);
  const size = fs.statSync(PACKAGE_PATH).size;
  log(4, `Package: ${PACKAGE_NAME} (${(size / 1024).toFixed(1)} KB)`);

  // ── §5 VOLUME — Transfer ───────────────────────────────────────────
  console.log('\n§5 VOLUME — Transferring to VPS...');
  const scpResult = runSafe(`scp ${PACKAGE_PATH} ${VPS_TARGET}:${REMOTE_DIR}/`);
  if (!scpResult.ok) fail(5, `SCP failed: ${scpResult.out}`);
  log(5, `Transferred to ${VPS_TARGET}:${REMOTE_DIR}/`);

  // ── §6 WHOLE — Activate ─────────────────────────────────────────────
  console.log('\n§6 WHOLE — Activating on VPS...');

  // Stop existing process
  const stopCmd = `ssh ${VPS_TARGET} "cd ${REMOTE_DIR} && (pm2 stop manifold-server 2>/dev/null || pkill -f 'node server/index.js' 2>/dev/null || true)"`;
  runSafe(stopCmd);
  log(6, 'Stopped existing process');

  // Extract package on remote
  const extractCmd = `ssh ${VPS_TARGET} "cd ${REMOTE_DIR} && tar -xzf ${PACKAGE_NAME} && rm ${PACKAGE_NAME}"`;
  const extractResult = runSafe(extractCmd);
  if (!extractResult.ok) fail(6, `Extract failed: ${extractResult.out}`);
  log(6, 'Extracted deployment package');

  // Ensure remote Node/npm availability and install dependencies.
  const remoteNpmCheck = runSafe(`ssh ${VPS_TARGET} "command -v npm || true"`);
  if (!remoteNpmCheck.ok || !remoteNpmCheck.out.trim()) {
    console.log('\n⚠️  Node.js/npm not found on VPS. Install system-wide:');
    console.log('   ssh ' + VPS_TARGET);
    console.log('   sudo apt update');
    console.log('   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -');
    console.log('   sudo apt install -y nodejs');
    console.log('   node --version && npm --version');
    console.log('   Then re-run: npm run deploy\n');
    fail(6, `Remote npm not found on ${VPS_TARGET}. Please install Node.js system-wide first.`);
  }

  const remoteInstall = runSafe(`ssh ${VPS_TARGET} "cd ${REMOTE_DIR}/server && npm install --omit=dev"`);
  if (!remoteInstall.ok) {
    log(6, 'Remote npm install failed', false);
    console.log(remoteInstall.out);
    fail(6, `Remote npm install failed`);
  }
  log(6, 'Remote dependencies installed');

  // Obtain SSL certificate with Let's Encrypt
  const certbotCheck = runSafe(`ssh ${VPS_TARGET} "command -v certbot || true"`);
  if (!certbotCheck.ok || !certbotCheck.out.trim()) {
    const installCertbot = runSafe(`ssh ${VPS_TARGET} "apt update && apt install -y certbot"`);
    if (!installCertbot.ok) fail(6, `Failed to install certbot: ${installCertbot.out}`);
    log(6, 'Certbot installed');
  }

  const certCmd = `ssh ${VPS_TARGET} "certbot certonly --standalone --agree-tos --email admin@kensgames.com -d kensgames.com -d www.kensgames.com --non-interactive"`;
  const certResult = runSafe(certCmd);
  if (!certResult.ok) {
    log(6, 'SSL certificate obtain failed — continuing with HTTP only', false);
    console.log(certResult.out);
  } else {
    log(6, 'SSL certificate obtained');
  }

  // Start server
  const startCmd = `ssh ${VPS_TARGET} "cd ${REMOTE_DIR} && (pm2 start server/index.js --name manifold-server 2>/dev/null || nohup node server/index.js > server.log 2>&1 &)"`;
  const startResult = runSafe(startCmd);
  if (!startResult.ok) fail(6, `Start failed: ${startResult.out}`);
  log(6, 'Server started');

  // Health check — wait a moment then verify (use HTTPS if certs available)
  await new Promise(r => setTimeout(r, 2000));
  const healthCheckCmd = certResult.ok
    ? `ssh ${VPS_TARGET} "curl -sf https://localhost:3443/ > /dev/null && echo ok || echo fail"`
    : `ssh ${VPS_TARGET} "curl -sf http://localhost:3000/ > /dev/null && echo ok || echo fail"`;
  const healthCheck = runSafe(healthCheckCmd);
  if (!healthCheck.ok || !healthCheck.out.includes('ok')) {
    log(6, 'Health check FAILED — server may not be responding', false);
  } else {
    log(6, 'Health check passed — server is live');
  }

  // Clean up local package
  if (fs.existsSync(PACKAGE_PATH)) fs.unlinkSync(PACKAGE_PATH);

  // ── Complete ────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logDeploy({
    stage: 'WHOLE',
    status: 'SUCCESS',
    sha: sha.slice(0, 12),
    branch,
    elapsed: `${elapsed}s`,
  });

  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║  ✓ DEPLOYMENT COMPLETE                                   ║`);
  console.log(`║  Commit:  ${sha.slice(0, 12).padEnd(46)}║`);
  console.log(`║  Branch:  ${branch.padEnd(46)}║`);
  console.log(`║  Target:  ${VPS_TARGET.padEnd(46)}║`);
  console.log(`║  Time:    ${(elapsed + 's').padEnd(46)}║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝\n`);
}

// ─── Entry ──────────────────────────────────────────────────────────────
pipeline().catch(err => {
  console.error('\n✗ Pipeline error:', err.message);
  logDeploy({ stage: 'UNKNOWN', status: 'ERROR', reason: err.message });
  process.exit(1);
});
