/**
 * start-internet-dev.js
 *
 * Starts Nebula so anyone on ANY internet can play — no ngrok account needed.
 *
 * Architecture:
 *   ┌────────────────────────────────────────────────────────────┐
 *   │  Your Mac                                                  │
 *   │  ┌───────────┐  SSH tunnel   ┌─────────────────────────┐  │
 *   │  │ Backend   │──────────────▶│ localhost.run (public)   │  │
 *   │  │ :3001     │               │ https://xxxx.lhr.life   │  │
 *   │  └───────────┘               └─────────────────────────┘  │
 *   │                                          ▲                 │
 *   │  ┌───────────┐  localtunnel  ┌───────────┴─────────────┐  │
 *   │  │ Metro     │──────────────▶│ localtunnel (public)     │  │
 *   │  │ :8081     │               │ https://xxxx.loca.lt    │  │
 *   │  └───────────┘               └─────────────────────────┘  │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Players open Expo Go → enter the exp:// link printed below → game connects.
 *
 * Usage: cd frontend && npm run start:internet
 * Requirements: ssh (built-in), node >= 18, internet connection
 */

'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');

const frontendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendRoot, '..');
const backendRoot = path.resolve(repoRoot, 'backend');

// ─── State ───────────────────────────────────────────────────────────────────
let backendProcess = null;
let backendTunnelProcess = null;
let metroTunnelProcess = null;
let expoProcess = null;
let backendStartedByScript = false;
let isShuttingDown = false;
let currentBackendUrl = null;
let isRecoveringBackend = false;
let backendFailureCount = 0;
let backendMonitorTimer = null;
let expoUrl = null;

// ─── Logging ─────────────────────────────────────────────────────────────────
const ts = () => new Date().toLocaleTimeString();
const log = (m) => console.log(`[nebula ${ts()}] ${m}`);
const err = (m) => console.error(`[nebula ${ts()}] ❌ ${m}`);

// ─── Child process helpers ────────────────────────────────────────────────────
function attachPrefixedOutput(name, child) {
  const pipe = (stream, write) => {
    let pending = '';
    stream.on('data', (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) write(`[${name}] ${l}\n`);
    });
    stream.on('end', () => { if (pending.trim()) write(`[${name}] ${pending}\n`); });
  };
  if (child.stdout) pipe(child.stdout, (l) => process.stdout.write(l));
  if (child.stderr) pipe(child.stderr, (l) => process.stderr.write(l));
}

function safeKill(child, signal = 'SIGTERM') {
  if (!child || child.killed) return;
  try { child.kill(signal); } catch { /* ignore */ }
}

// ─── Port helpers ─────────────────────────────────────────────────────────────
function isPortListening(port) {
  try {
    return execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim().length > 0;
  } catch { return false; }
}

function getListeningPids(port) {
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (!out) return [];
    return out.split(/\s+/).map(Number).filter((p) => p > 0 && p !== process.pid);
  } catch { return []; }
}

async function freePort(port) {
  let pids = getListeningPids(port);
  if (pids.length === 0) return;
  log(`Port ${port} busy — stopping ${pids.join(', ')}`);
  pids.forEach((p) => { try { process.kill(p, 'SIGTERM'); } catch { /* ok */ } });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await delay(200);
    if (getListeningPids(port).length === 0) return;
  }
  getListeningPids(port).forEach((p) => { try { process.kill(p, 'SIGKILL'); } catch { /* ok */ } });
  await delay(300);
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── HTTP helper ──────────────────────────────────────────────────────────────
const TUNNEL_HEADERS = {
  'bypass-tunnel-reminder': 'true',
  'ngrok-skip-browser-warning': 'true',
  'User-Agent': 'NebulaInternetDev/1.0',
};

async function fetchSafe(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: TUNNEL_HEADERS });
  } finally { clearTimeout(t); }
}

// ─── Backend ──────────────────────────────────────────────────────────────────
function startBackendIfNeeded() {
  if (isPortListening(3001)) { log('Backend already on :3001'); return; }
  log('Starting backend ...');
  backendStartedByScript = true;
  backendProcess = spawn('npm', ['run', 'dev'], {
    cwd: backendRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  attachPrefixedOutput('backend', backendProcess);
  backendProcess.on('exit', (code) => {
    if (!isShuttingDown) { err(`Backend exited (${code})`); shutdown(1); }
  });
}

async function waitForBackend(ms = 60000) {
  log('Waiting for backend on :3001 ...');
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetchSafe('http://127.0.0.1:3001/health', 6000);
      if (r.ok) { log('✅ Backend healthy'); return true; }
    } catch { /* retry */ }
    await delay(1000);
  }
  return false;
}

// ─── Tunnel URL extraction ────────────────────────────────────────────────────
function waitForTunnelUrl(child, name, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let done = false;
    const finish = (e, url) => {
      if (done) return; done = true;
      clearTimeout(timer); child.off('exit', onExit);
      if (e) reject(e); else resolve(url);
    };
    const scan = (text, write) => {
      write(text);
      const m = text.match(pattern);
      if (m) finish(null, m[0]);
    };
    const onData = (source) => (chunk) => {
      const write = source === 'out'
        ? (l) => process.stdout.write(`[${name}] ${l}`)
        : (l) => process.stderr.write(`[${name}] ${l}`);
      buf += chunk.toString();
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? '';
      for (const l of parts) scan(`${l}\n`, write);
      if (buf) scan(buf, write);
    };
    const onExit = (c) => finish(new Error(`${name} exited (${c}) before URL found`));
    const timer = setTimeout(() => finish(new Error(`${name} timed out`)), timeoutMs);
    child.on('exit', onExit);
    if (child.stdout) child.stdout.on('data', onData('out'));
    if (child.stderr) child.stderr.on('data', onData('err'));
  });
}

// ─── Backend tunnel: localhost.run SSH → localtunnel fallback ─────────────────
async function startLocalhostRunTunnel() {
  log('Opening backend tunnel via localhost.run (SSH) ...');
  const child = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=20',
    '-R', '80:localhost:3001',
    'nokey@localhost.run',
  ], { cwd: repoRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await waitForTunnelUrl(child, 'lhr', /https:\/\/[a-z0-9.-]+\.lhr\.life/i, 45000);
  return { child, url, source: 'localhost.run' };
}

async function startLocaltunnelBackend() {
  log('Falling back to localtunnel for backend ...');
  const child = spawn('npx', ['--yes', 'localtunnel', '--port', '3001'], {
    cwd: repoRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await waitForTunnelUrl(child, 'lt-backend', /https:\/\/[a-z0-9-]+\.loca\.lt/i, 60000);
  return { child, url, source: 'localtunnel' };
}

async function startBackendTunnel() {
  try { return await startLocalhostRunTunnel(); }
  catch (e) { log(`localhost.run failed: ${e.message}`); return startLocaltunnelBackend(); }
}

async function isBackendLive(url) {
  try {
    const r = await fetchSafe(`${url}/health`, 12000);
    if (!r.ok) return false;
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) return false;
    const body = await r.json();
    return body?.status === 'ok';
  } catch { return false; }
}

async function acquireLiveBackendTunnel(attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    const t = await startBackendTunnel();
    if (await isBackendLive(t.url)) return t;
    log(`Backend tunnel health check failed (${i}/${attempts}), retrying ...`);
    safeKill(t.child);
    await delay(1000);
  }
  throw new Error('Could not establish a live backend tunnel');
}

// ─── Metro tunnel: localhost.run SSH on :8081 → localtunnel fallback ──────────
async function startMetroLocalhostRun() {
  log('Opening Metro tunnel via localhost.run (SSH) ...');
  const child = spawn('ssh', [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=20',
    '-R', '80:localhost:8081',
    'nokey@localhost.run',
  ], { cwd: repoRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await waitForTunnelUrl(child, 'lhr-metro', /https:\/\/[a-z0-9.-]+\.lhr\.life/i, 45000);
  return { child, url, source: 'localhost.run' };
}

async function startMetroLocaltunnel() {
  log('Falling back to localtunnel for Metro ...');
  const child = spawn('npx', ['--yes', 'localtunnel', '--port', '8081'], {
    cwd: repoRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const url = await waitForTunnelUrl(child, 'lt-metro', /https:\/\/[a-z0-9-]+\.loca\.lt/i, 60000);
  return { child, url, source: 'localtunnel' };
}

async function startMetroTunnel() {
  try { return await startMetroLocalhostRun(); }
  catch (e) { log(`Metro localhost.run failed: ${e.message}`); return startMetroLocaltunnel(); }
}

// ─── Expo (LAN mode — Metro bundler only, served via Metro tunnel) ────────────
function stopExpoProcess() {
  if (!expoProcess) return;
  const old = expoProcess;
  expoProcess = null;          // null FIRST so exit handler doesn't cascade
  safeKill(old);
  setTimeout(() => safeKill(old, 'SIGKILL'), 1500);
}

function startExpo(apiUrl, { packagerHostname, packagerProxyUrl } = {}) {
  log(`Starting Expo (LAN mode), EXPO_PUBLIC_API_URL=${apiUrl}`);
  expoProcess = spawn('npx', ['expo', 'start', '--lan', '--port', '8081'], {
    cwd: frontendRoot,
    env: {
      ...process.env,
      EXPO_PUBLIC_API_URL: apiUrl,
      EXPO_PUBLIC_WS_URL: apiUrl,
      // Force the manifest to advertise a public URL (no :8081) so Expo Go can load it.
      ...(packagerProxyUrl ? { EXPO_PACKAGER_PROXY_URL: packagerProxyUrl } : {}),
      ...(packagerHostname ? { REACT_NATIVE_PACKAGER_HOSTNAME: packagerHostname } : {}),
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  attachPrefixedOutput('expo', expoProcess);

  const ref = expoProcess;
  ref.on('exit', (code) => {
    if (!isShuttingDown && !isRecoveringBackend && expoProcess === ref) {
      shutdown(code || 0);
    }
  });
}

async function waitForExpoUrl(ms = 120000) {
  log('Waiting for Expo URL ...');
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (expoUrl) return expoUrl;
    await delay(300);
  }
  return null;
}

function watchExpoOutputForUrl(child) {
  if (!child?.stdout) return;
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    // Expo --json output includes URLs inside JSON fields.
    const m =
      text.match(/"url"\s*:\s*"(exp:\/\/[^"]+)"/m) ||
      text.match(/"manifestUrl"\s*:\s*"(exp:\/\/[^"]+)"/m) ||
      text.match(/"url"\s*:\s*"(https:\/\/exp\.host\/[^"]+)"/m) ||
      text.match(/"manifestUrl"\s*:\s*"(https:\/\/exp\.host\/[^"]+)"/m) ||
      // Fallback: plain-text exp:// URL
      text.match(/exp:\/\/[A-Za-z0-9.\-_:/?=&%]+/m) ||
      text.match(/https:\/\/exp\.host\/[A-Za-z0-9.\-_/?:=&%]+/m);
    if (m && !expoUrl) {
      expoUrl = (m[1] || m[0]).trim();
    }
  });
}

async function waitForMetroPort(ms = 60000) {
  log('Waiting for Metro on :8081 ...');
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (isPortListening(8081)) { log('✅ Metro is up on :8081'); return true; }
    await delay(300);
  }
  return false;
}

// ─── Backend tunnel monitor & auto-recovery ───────────────────────────────────
function clearMonitor() {
  if (backendMonitorTimer) { clearInterval(backendMonitorTimer); backendMonitorTimer = null; }
}

async function recoverBackendTunnel() {
  if (isShuttingDown || isRecoveringBackend) return;
  isRecoveringBackend = true;
  clearMonitor();
  try {
    safeKill(backendTunnelProcess);
    backendTunnelProcess = null;
    currentBackendUrl = null;
    backendFailureCount = 0;
    const t = await acquireLiveBackendTunnel();
    backendTunnelProcess = t.child;
    currentBackendUrl = t.url;
    log(`✅ Recovered backend URL (${t.source}): ${t.url}`);
    watchBackendExit();
    startMonitor();
    log('⚠️  Backend URL changed! Restart the app (shake → Reload) to reconnect.');
  } catch (e) {
    err(`Recovery failed: ${e.message}`);
    isRecoveringBackend = false;
    shutdown(1);
    return;
  }
  await delay(200);
  isRecoveringBackend = false;
}

function watchBackendExit() {
  if (!backendTunnelProcess) return;
  backendTunnelProcess.on('exit', (code) => {
    if (!isShuttingDown && !isRecoveringBackend) {
      log(`Backend tunnel exited (${code}). Recovering ...`);
      recoverBackendTunnel();
    }
  });
}

function startMonitor() {
  clearMonitor();
  backendMonitorTimer = setInterval(async () => {
    if (isShuttingDown || isRecoveringBackend || !currentBackendUrl) return;
    if (await isBackendLive(currentBackendUrl)) { backendFailureCount = 0; return; }
    backendFailureCount++;
    log(`Backend tunnel health check failed (${backendFailureCount}/2)`);
    if (backendFailureCount >= 2) recoverBackendTunnel();
  }, 20000);
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────
function shutdown(exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearMonitor();
  log('Shutting down ...');
  safeKill(expoProcess);
  safeKill(backendTunnelProcess);
  safeKill(metroTunnelProcess);
  if (backendStartedByScript) safeKill(backendProcess);
  setTimeout(() => {
    safeKill(expoProcess, 'SIGKILL');
    safeKill(backendTunnelProcess, 'SIGKILL');
    safeKill(metroTunnelProcess, 'SIGKILL');
    if (backendStartedByScript) safeKill(backendProcess, 'SIGKILL');
    process.exit(exitCode);
  }, 1500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (e) => { err(`Uncaught: ${e.message}`); shutdown(1); });
process.on('unhandledRejection', (e) => { err(`Rejection: ${e?.message ?? e}`); shutdown(1); });

// ─── URL helpers ──────────────────────────────────────────────────────────────
function toExpoLink(publicHttpsUrl) {
  // exp:// link using the tunnel hostname — Expo Go accepts this
  const host = publicHttpsUrl.replace(/^https?:\/\//i, '');
  return `exp://${host}`;
}

function printQr(url) {
  try {
    execSync(`npx --yes qrcode-terminal '${url.replace(/'/g, "'\\''")}'`, { stdio: 'inherit' });
  } catch {
    log('Could not render QR. Share the URL manually.');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log();
  log('════════════════════════════════════════════════');
  log('  Nebula — Internet Dev Mode');
  log('  Anyone on any network can join!');
  log('════════════════════════════════════════════════\n');

  // 1. Start backend
  startBackendIfNeeded();
  if (!(await waitForBackend(60000))) {
    throw new Error('Backend did not become healthy within 60 s');
  }

  // 2. Backend tunnel
  const backendTunnel = await acquireLiveBackendTunnel();
  backendTunnelProcess = backendTunnel.child;
  currentBackendUrl = backendTunnel.url;
  backendFailureCount = 0;
  log(`\n✅ Backend public URL (${backendTunnel.source}): ${backendTunnel.url}\n`);
  watchBackendExit();
  startMonitor();

  // 3. Start Expo in LAN mode (Metro on :8081, output goes to pipe so we can detect readiness)
  await freePort(8081);
  // 3a. Open a public tunnel to Metro FIRST so we can set the packager host.
  //     Without this, Expo's manifest will advertise a LAN host and Expo Go will show:
  //     "Package not running".
  log('\nOpening public tunnel to Metro bundler ...');
  const metroTunnel = await startMetroTunnel();
  metroTunnelProcess = metroTunnel.child;
  const metroHost = metroTunnel.url.replace(/^https?:\/\//i, '');

  // 3b. Start Expo and force the manifest to use the tunnel host
  log(`Using REACT_NATIVE_PACKAGER_HOSTNAME=${metroHost}`);
  log(`Using EXPO_PACKAGER_PROXY_URL=${metroTunnel.url}`);
  startExpo(backendTunnel.url, { packagerHostname: metroHost, packagerProxyUrl: metroTunnel.url });

  // 4. Wait for Metro to be ready
  if (!(await waitForMetroPort(90000))) {
    throw new Error('Metro did not start on :8081 within 90 s');
  }

  // 5. Expo Go URL is the metro tunnel host
  const expoLink = toExpoLink(metroTunnel.url);

  console.log();
  log('════════════════════════════════════════════════');
  log(`  Metro tunnel (${metroTunnel.source}): ${metroTunnel.url}`);
  log(`  Backend tunnel:  ${backendTunnel.url}`);
  log('════════════════════════════════════════════════');
  log(`\n📱 Open Expo Go → Enter URL manually → paste:`);
  log(`   ${expoLink}\n`);
  log('   OR scan this QR code:\n');
  printQr(expoLink);
  log('\n   Anyone on any internet can join!\n');
}

main().catch((e) => { err(`Startup failed: ${e.message}`); shutdown(1); });
