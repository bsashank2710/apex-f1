const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

// Load mobile/.env into process.env before Babel reads EXPO_PUBLIC_* (helps web + workers).
try {
  require('@expo/env').load(path.resolve(__dirname));
} catch {
  /* ignore if unavailable */
}

module.exports = getDefaultConfig(__dirname);
