// Stand-in for `isomorphic-webcrypto/src/react-native`, which lib0's React
// Native entry point requires but which is unmaintained. lib0 calls
// ensureSecure() at module scope, then uses getRandomValues (Yjs client
// ids); `subtle` is used only by lib0 hash modules we never import.
const Crypto = require('expo-crypto');

function getRandomValues(typedArray) {
  return Crypto.getRandomValues(typedArray);
}

// isomorphic-webcrypto used this to seed its RNG before use; expo-crypto is
// natively backed, so there is nothing to seed.
function ensureSecure() {}

module.exports = { ensureSecure, getRandomValues, subtle: undefined };
