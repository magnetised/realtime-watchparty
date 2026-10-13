import { neon } from "@neondatabase/serverless";
import "./env.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error("DATABASE_URL is required. Run `pnpm provision` first.");
}

export const sql = neon(connectionString, { fullResults: false });

export const databaseName = decodeURIComponent(
	new URL(connectionString).pathname.slice(1),
);

export async function ensureSchema(): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS watch_rooms (
			id uuid PRIMARY KEY,
			youtube_id text NOT NULL CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
			title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 180),
			thumbnail_url text NOT NULL,
			created_by text NOT NULL CHECK (char_length(created_by) BETWEEN 1 AND 32),
			playback_state text NOT NULL DEFAULT 'playing'
				CHECK (playback_state IN ('playing', 'paused')),
			position_seconds double precision NOT NULL DEFAULT 0
				CHECK (position_seconds >= 0),
			state_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
			created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
			updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS watch_viewers (
			room_id uuid NOT NULL REFERENCES watch_rooms(id) ON DELETE CASCADE,
			user_id uuid NOT NULL,
			name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
			joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
			last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
			PRIMARY KEY (room_id, user_id)
		)
	`;

	await sql`
		CREATE INDEX IF NOT EXISTS watch_viewers_room_seen_idx
		ON watch_viewers (room_id, last_seen_at DESC)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS watch_messages (
			id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			room_id uuid NOT NULL REFERENCES watch_rooms(id) ON DELETE CASCADE,
			user_id uuid NOT NULL,
			name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 32),
			body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
			created_at timestamptz NOT NULL DEFAULT clock_timestamp()
		)
	`;

	await sql`
		CREATE INDEX IF NOT EXISTS watch_messages_room_created_idx
		ON watch_messages (room_id, created_at DESC)
	`;
}
