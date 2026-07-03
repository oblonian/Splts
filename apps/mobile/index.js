// Hermes has no WebCrypto; without this, id generation in @splts/core would
// fall back to Math.random — too weak for group ids that act as invite secrets.
import { getRandomValues } from 'expo-crypto';

if (!globalThis.crypto) globalThis.crypto = {};
if (typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto.getRandomValues = (array) => getRandomValues(array);
}

import { registerRootComponent } from 'expo';
import App from './src/App';

registerRootComponent(App);
