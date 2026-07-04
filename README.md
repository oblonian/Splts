# Splts

Open-source, decentralized expense splitting — a Splitwise alternative with no
company in the middle.

- **Local-first**: every device keeps a full copy of the group ledger. The app
  works fully offline; nothing is lost if every server disappears.
- **CRDT-based**: the ledger is an append-only event log inside a
  [Yjs](https://yjs.dev) document. Two people adding expenses offline never
  conflict — devices converge to the same state when they reconnect.
- **Dumb relay**: devices sync through a tiny self-hostable WebSocket relay
  that holds CRDT bytes and forwards updates. It has zero business logic, and
  any y-websocket-compatible server can replace it.

## Architecture

```
 phone A ──┐                      ┌── phone B
  (full    │   ws://your-relay    │   (full
   local   ├──── [dumb relay] ────┤    local
   ledger) │    no business logic │    ledger)
           └──────────────────────┘
```

Balances are never stored — they are recomputed by replaying the event log
(`expense-added`, `expense-voided`, `payment-recorded`). That replay is
order-independent, which is what makes concurrent offline edits merge cleanly.
All money amounts are integers in minor units (cents); floating point never
touches a balance.

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | Shared TypeScript: ledger types, balance computation, greedy settle-up, Yjs doc schema. Fully unit-tested. |
| `packages/relay` | ~200-line Node WebSocket relay (Yjs sync + awareness protocol), optional disk snapshots, Dockerfile. |
| `apps/mobile` | Expo React Native app: groups, expenses, balances, settle-up, invite codes. Persists via AsyncStorage, syncs via y-websocket. |

## Quick start

```bash
npm install

# 1. Run the tests
npm test

# 2. Start a relay (terminal 1)
npm run relay                       # ws://localhost:4444, in-memory
# or with persistence:
DATA_DIR=./data npm run relay
# or in Docker:
docker build -t splts-relay packages/relay && docker run -p 4444:4444 splts-relay

# 3. Start the mobile app (terminal 2)
cd apps/mobile && npx expo start    # scan the QR with Expo Go
```

On a real phone, `localhost` won't reach your relay — use your machine's LAN
IP (e.g. `ws://192.168.1.20:4444`) in the group's relay field.

**Inviting someone**: open a group → *Invite someone*. The invite code is
`<group-id>@<relay-url>`; the group id doubles as the sync room name.

## Hosting a relay

Anywhere Node runs: a $4 VPS, Fly.io, Railway, a Raspberry Pi. Configuration
is two environment variables: `PORT` (default 4444) and `DATA_DIR` (optional
snapshot directory; without it the relay is purely in-memory and peers re-seed
it on reconnect). Because the relay is interchangeable, a group can migrate
relays at any time — the devices hold the data.

## Syncing over the internet

Splts syncs through a relay — a tiny "dumb pipe" server that never sees your
balances. There is no public relay you can trust with your data (the Yjs
community demo relay has been retired), so run your own — it's free:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/oblonian/Splts)

1. Click the button, sign in with GitHub, deploy (free plan is fine).
2. Copy the service URL Render gives you and change `https://` to `wss://`
   (e.g. `wss://splts-relay-xxxx.onrender.com`).
3. Paste it as the sync server when creating a friend/group. The app
   remembers it for next time, and invites carry it automatically.

Note: Render's free plan sleeps after ~15 idle minutes; the first sync after
a quiet period takes ~30–60 s to wake it. Any other host works too —
`packages/relay` runs anywhere Node or Docker runs. An existing ledger's
server can be changed from its screen ("Not syncing?").

## iOS

Apple doesn't allow direct sideloading. Options, in increasing effort:

1. **Expo Go** (free, instant): `cd apps/mobile && npx expo start`, scan the QR.
2. **Unsigned IPA** (`splts-unsigned.ipa` on the release page): install with
   [AltStore](https://altstore.io) or Sideloadly using a free Apple ID
   (re-sign every 7 days on a free account).
3. **TestFlight / App Store**: requires a $99/yr Apple Developer account.

## Honest limitations (v0)

- **No end-to-end encryption yet.** The relay stores CRDT bytes it could
  decode. Roadmap: encrypt updates client-side with a group key shared in the
  invite code, making the relay truly zero-knowledge.
- **Possession of the group id = membership.** Invite codes are capabilities;
  treat them like a shared secret. Roadmap: per-device keypairs and signed
  membership.
- **One currency per group, equal splits only** in the UI (the core supports
  arbitrary per-member shares).
- **Settlement is informational** — the app computes who owes whom; actual
  money moves outside the app (UPI/Venmo/cash), which is deliberate: payment
  rails can't be decentralized from an app.

## License

MIT
