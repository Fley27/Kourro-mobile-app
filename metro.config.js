// Expo SDK 51 monorepo config: the @retail/* workspace packages live in the
// repo root's node_modules (npm workspaces symlinks), outside this app's
// folder. Metro must watch the workspace root to see their dist/ output and
// resolve from the root node_modules as a fallback.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
