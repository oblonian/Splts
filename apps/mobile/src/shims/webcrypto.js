// Stand-in for `isomorphic-webcrypto/src/react-native`, which lib0's React
// Native entry point requires but which is unmaintained. lib0 only needs
// getRandomValues here (Yjs client ids); `subtle` is used by lib0 hash
// modules we never import.
const Crypto = require('expo-crypto');

function getRandomValues(typedArray) {
  return Crypto.getRandomValues(typedArray);
}

module.exports = { getRandomValues, subtle: undefined };
