#!/usr/bin/env node
/** Print a suggested EXPO_PUBLIC_API_URL for a physical device on the same Wi‑Fi. */
const os = require('os');
const nets = os.networkInterfaces();
for (const list of Object.values(nets)) {
  if (!list) continue;
  for (const net of list) {
    if (net.family !== 'IPv4' && net.family !== 4) continue;
    if (net.internal) continue;
    console.log(`EXPO_PUBLIC_API_URL=http://${net.address}:8000`);
    process.exit(0);
  }
}
console.error('No non-internal IPv4 found; set EXPO_PUBLIC_API_URL manually.');
process.exit(1);
