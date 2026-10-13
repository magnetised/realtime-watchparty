# Watchhouse

A YouTube watch-party application built with the published `@neon/realtime` and
`@neon/realtime-react` packages. Neon Postgres stores rooms, playback checkpoints,
viewer heartbeats, and chat; sealed live queries keep every browser synchronized.

## Run it against Neon staging

From this directory:

```bash
corepack pnpm install
NEON_API_KEY='<staging-api-key>' pnpm provision
pnpm dev
```

`provision` creates a new staging project, enables Realtime for localhost, waits for
provisioning, and writes the connection string, Realtime URL, and server-only sealing
secret to the gitignored `.env.local`. The management API key is not written to disk.
Open `http://localhost:8787` in two browser windows to try synchronization.

Use `YOUTUBE_API_KEY` in `.env.local` for the official YouTube Data API. Without it,
the app searches a configurable public Piped-compatible API, supports pasted YouTube
URLs through oEmbed, and falls back to a built-in catalogue when the public service is
unavailable.

## How synchronization works

- A room row stores `playing`/`paused`, the media position, and the database time at
  which that checkpoint was written.
- The room live query calculates the authoritative position at subscription time.
  A late joiner seeks there, then extrapolates locally while the video is playing.
- YouTube player events write a fresh checkpoint. Neon Realtime publishes the changed
  query result to every viewer, which corrects play state and drift.
- Viewer heartbeats and chat messages are ordinary Postgres mutations observed through
  separate sealed live queries. Capabilities are issued only by the server and renewed
  automatically by `@neon/realtime-react`.

The browser receives only sealed query capabilities and the Realtime WebSocket URL.
`NEON_REALTIME_SECRET` and `DATABASE_URL` stay in the application server.
