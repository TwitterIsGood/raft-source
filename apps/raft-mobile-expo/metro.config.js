const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// This app is self-contained. Expo's monorepo defaults watch every Raft package,
// which makes the iOS development bundle stall while crawling the full checkout.
config.watchFolders = [];
config.resolver.nodeModulesPaths = [require("node:path").join(__dirname, "node_modules")];

module.exports = config;
