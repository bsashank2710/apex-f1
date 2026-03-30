#!/usr/bin/env node
/**
 * Print a QR in the terminal for the latest finished EAS Android build (APK download URL),
 * same as tapping Install on expo.dev — but HERE in your shell.
 *
 * Usage:
 *   node scripts/qr-install-apk.js
 *   node scripts/qr-install-apk.js <build-id>
 */
const { execSync } = require('child_process');
const path = require('path');
const qrcode = require('qrcode-terminal');

const mobileRoot = path.join(__dirname, '..');
const buildIdArg = process.argv[2];

function runEas(args) {
  return execSync(`npx eas-cli@latest ${args.join(' ')}`, {
    cwd: mobileRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

let id;
let url;

if (buildIdArg) {
  id = buildIdArg.trim();
  const raw = runEas(['build:view', id, '--json']);
  const j = JSON.parse(raw.trim());
  if (j.status !== 'FINISHED') {
    console.error(`Build ${id} is not FINISHED (status: ${j.status}).`);
    process.exit(1);
  }
  url = j.artifacts?.buildUrl || j.artifacts?.applicationArchiveUrl;
} else {
  const raw = runEas([
    'build:list',
    '--platform',
    'android',
    '--status',
    'finished',
    '--limit',
    '1',
    '--json',
    '--non-interactive',
  ]);
  const arr = JSON.parse(raw.trim());
  if (!arr?.length) {
    console.error('No finished Android builds found. Run a cloud build first.');
    process.exit(1);
  }
  id = arr[0].id;
  url = arr[0].artifacts?.buildUrl || arr[0].artifacts?.applicationArchiveUrl;
}

if (!url) {
  console.error('No APK URL on that build yet.');
  process.exit(1);
}

const pageUrl = `https://expo.dev/accounts/sashank_b/projects/apex-f1/builds/${id}`;

console.log('\n━━ APK install (scan with phone camera — opens download) ━━\n');
qrcode.generate(url, { small: true });
console.log(`\n${url}\n`);
console.log(`Build page: ${pageUrl}\n`);
console.log('(Expo Go dev server QR = run: npm run qr  from repo root)\n');
