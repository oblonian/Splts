// Expo monorepo config: let Metro see the workspace root so @splts/core
// resolves from packages/core (it ships TypeScript source; Metro transpiles it).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// lib0 (a Yjs dependency) resolves its webcrypto through the unmaintained
// isomorphic-webcrypto package on React Native; route it to our expo-crypto
// backed shim instead.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('isomorphic-webcrypto')) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(projectRoot, 'src', 'shims', 'webcrypto.js'),
    };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
