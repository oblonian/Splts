// Read-only sync check for a Splts room. Prints only counts — never ledger
// contents — because CI logs on a public repo are public.
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';

const [relay, room] = process.argv.slice(2);
if (!relay || !room) {
  console.error('usage: verify-room.mjs <relay-url> <room-id>');
  process.exit(2);
}

const doc = new Y.Doc();
const provider = new WebsocketProvider(relay, `splts-${room}`, doc, {
  WebSocketPolyfill: WebSocket,
  disableBc: true,
});
provider.on('status', ({ status }) => console.log('connection:', status));

const deadline = Date.now() + 25000;
const poll = setInterval(() => {
  const synced = provider.synced;
  const name = doc.getMap('meta').get('name');
  if ((synced && name) || Date.now() > deadline) {
    clearInterval(poll);
    console.log('synced:', synced);
    console.log('has group meta:', Boolean(name));
    console.log('kind:', doc.getMap('meta').get('kind') ?? '(unset)');
    console.log('currency:', doc.getMap('meta').get('currency') ?? '(unset)');
    console.log('members:', doc.getMap('members').size);
    console.log('events:', doc.getArray('events').length);
    provider.destroy();
    process.exit(synced && name ? 0 : 1);
  }
}, 500);
