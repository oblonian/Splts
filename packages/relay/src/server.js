#!/usr/bin/env node
/**
 * Splts relay: a dumb sync pipe.
 *
 * Speaks the standard Yjs websocket protocol (sync + awareness), one room per
 * group. The relay holds each room's CRDT document so late joiners and
 * offline devices can catch up, but it contains zero business logic — it
 * never parses expenses, computes balances, or knows what the bytes mean.
 * Any y-websocket-compatible server can replace it.
 *
 * Usage:
 *   node src/server.js                     # in-memory only, port 4444
 *   PORT=8080 DATA_DIR=./data node src/server.js   # snapshot rooms to disk
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const PORT = Number(process.env.PORT ?? 4444);
const DATA_DIR = process.env.DATA_DIR ?? null;
const SNAPSHOT_DEBOUNCE_MS = 2000;

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

/** @type {Map<string, Room>} */
const rooms = new Map();

class Room {
  /** @param {string} name */
  constructor(name) {
    this.name = name;
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    /** @type {Set<import('ws').WebSocket>} */
    this.conns = new Set();
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.snapshotTimer = null;

    if (DATA_DIR) this.load();

    this.doc.on('update', (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder), origin);
      this.scheduleSnapshot();
    });

    this.awareness.on('update', ({ added, updated, removed }, origin) => {
      const changed = added.concat(updated, removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
      );
      this.broadcast(encoding.toUint8Array(encoder), origin);
    });
  }

  snapshotPath() {
    // Room names are client-supplied: never let them become path segments.
    const safe = Buffer.from(this.name).toString('base64url');
    return path.join(DATA_DIR, `${safe}.yjs`);
  }

  load() {
    try {
      const snapshot = fs.readFileSync(this.snapshotPath());
      Y.applyUpdate(this.doc, new Uint8Array(snapshot));
      console.log(`[room ${this.name}] loaded snapshot (${snapshot.length} bytes)`);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[room ${this.name}] snapshot load failed:`, err);
    }
  }

  scheduleSnapshot() {
    if (!DATA_DIR) return;
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      const update = Y.encodeStateAsUpdate(this.doc);
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const target = this.snapshotPath();
      const tmp = `${target}.tmp`;
      fs.writeFileSync(tmp, update);
      fs.renameSync(tmp, target);
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  /**
   * @param {Uint8Array} message
   * @param {unknown} exclude connection the message originated from
   */
  broadcast(message, exclude) {
    for (const conn of this.conns) {
      if (conn !== exclude && conn.readyState === conn.OPEN) conn.send(message);
    }
  }

  /** @param {import('ws').WebSocket} conn */
  addConnection(conn) {
    this.conns.add(conn);

    conn.on('message', (data) => {
      try {
        this.handleMessage(conn, new Uint8Array(data));
      } catch (err) {
        console.error(`[room ${this.name}] bad message:`, err);
      }
    });

    conn.on('close', () => this.removeConnection(conn));
    conn.on('error', () => this.removeConnection(conn));

    // Step 1: tell the client what we have; it replies with what we're missing.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    conn.send(encoding.toUint8Array(encoder));

    const states = this.awareness.getStates();
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...states.keys()]),
      );
      conn.send(encoding.toUint8Array(awarenessEncoder));
    }
  }

  /**
   * @param {import('ws').WebSocket} conn
   * @param {Uint8Array} message
   */
  handleMessage(conn, message) {
    const decoder = decoding.createDecoder(message);
    const type = decoding.readVarUint(decoder);
    switch (type) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, conn);
        if (encoding.length(encoder) > 1) conn.send(encoding.toUint8Array(encoder));
        break;
      }
      case MSG_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        );
        break;
      }
    }
  }

  /** @param {import('ws').WebSocket} conn */
  removeConnection(conn) {
    if (!this.conns.delete(conn)) return;
    if (this.conns.size === 0) {
      // Flush any pending snapshot, then free memory. Doc state survives on
      // disk (with DATA_DIR) or on the peers' devices — the relay is not the
      // source of truth.
      if (this.snapshotTimer) {
        clearTimeout(this.snapshotTimer);
        this.snapshotTimer = null;
        if (DATA_DIR) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(this.snapshotPath(), Y.encodeStateAsUpdate(this.doc));
        }
      }
      this.awareness.destroy();
      this.doc.destroy();
      rooms.delete(this.name);
      console.log(`[room ${this.name}] closed (no connections)`);
    }
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, rooms: rooms.size, persistence: Boolean(DATA_DIR) }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (conn, req) => {
  const roomName = (req.url ?? '/').slice(1).split('?')[0] || 'default';
  let room = rooms.get(roomName);
  if (!room) {
    room = new Room(roomName);
    rooms.set(roomName, room);
    console.log(`[room ${roomName}] opened`);
  }
  room.addConnection(conn);
});

server.listen(PORT, () => {
  console.log(`Splts relay listening on :${PORT} (persistence: ${DATA_DIR ?? 'off'})`);
});
