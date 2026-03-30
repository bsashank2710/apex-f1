#!/usr/bin/env node
/** Opens this app’s page on expo.dev (browser). */
const { execSync } = require('child_process');
const { platform } = require('process');

const url = 'https://expo.dev/accounts/sashank_b/projects/apex-f1';

try {
  if (platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' });
  else if (platform === 'win32') execSync(`start "" "${url}"`, { shell: true, stdio: 'ignore' });
  else execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
  console.log('Opened:', url);
} catch {
  console.log('Open this in your browser:\n', url);
}
