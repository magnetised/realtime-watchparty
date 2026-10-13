import { randomUUID } from "node:crypto";
import {
	createRealtimeClient,
	type SealedLiveQuery,
} from "@neon/realtime/client";
import { sql } from "../server/db.js";

type RoomState = {
	id: string;
	playback_state: "playing" | "paused";
	position_seconds: number;
};

type LobbyRoom = { id: string; viewer_count: number };
type Viewer = { user_id: string; name: string };
type Message = { id: string; body: string };

const baseUrl = process.env.APP_URL ?? "http://localhost:8787";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(new URL(path, baseUrl), {
		...init,
		headers: init?.body
			? { "content-type": "application/json" }
			: undefined,
	});
	if (!response.ok) throw new Error(`${path} returned ${response.status}`);
	return response.status === 204
		? (undefined as T)
		: ((await response.json()) as T);
}

const host = { userId: randomUUID(), name: "Realtime Host" };
const guest = { userId: randomUUID(), name: "Realtime Guest" };
await sql`DELETE FROM watch_rooms
	WHERE title = 'Big Buck Bunny — Realtime watch party'
		AND created_by = 'Realtime Host'`;
const { realtimeUrl } = await request<{ realtimeUrl: string }>("/api/config");
const { id: roomId } = await request<{ id: string }>("/api/rooms", {
	method: "POST",
	body: JSON.stringify({
		...host,
		youtubeId: "aqz-KE-bpKQ",
		title: "Big Buck Bunny — Realtime watch party",
	}),
});

async function seal<Row>(resource: string): Promise<SealedLiveQuery<Row>> {
	return request<SealedLiveQuery<Row>>(resource, { method: "POST" });
}

const client = createRealtimeClient({ url: realtimeUrl, logLevel: "warn" });
try {
	const lobby = client.subscribe(
		await seal<LobbyRoom>("/api/realtime/lobby"),
	);
	await lobby.awaitRows(
		(rows) => rows.some((row) => row.id === roomId),
		20_000,
	);

	const state = client.subscribe(
		await seal<RoomState>(`/api/realtime/rooms/${roomId}/state`),
	);
	await state.awaitRows((rows) => rows.length === 1, 20_000);

	await request<void>(`/api/rooms/${roomId}/playback`, {
		method: "PATCH",
		body: JSON.stringify({
			...host,
			state: "paused",
			position: 42,
		}),
	});
	await state.awaitRows(
		(rows) =>
			rows[0]?.playback_state === "paused" &&
			Math.abs(Number(rows[0].position_seconds) - 42) < 0.1,
		20_000,
	);

	const viewers = client.subscribe(
		await seal<Viewer>(`/api/realtime/rooms/${roomId}/viewers`),
	);
	await viewers.awaitRows(
		(rows) => rows.some((row) => row.user_id === host.userId),
		20_000,
	);
	await request<void>(`/api/rooms/${roomId}/join`, {
		method: "POST",
		body: JSON.stringify(guest),
	});
	await viewers.awaitRows(
		(rows) => rows.some((row) => row.user_id === guest.userId),
		20_000,
	);
	await lobby.awaitRows(
		(rows) =>
			Number(rows.find((row) => row.id === roomId)?.viewer_count) >= 2,
		20_000,
	);

	const messages = client.subscribe(
		await seal<Message>(`/api/realtime/rooms/${roomId}/messages`),
	);
	await request<{ ok: true }>(`/api/rooms/${roomId}/messages`, {
		method: "POST",
		body: JSON.stringify({ ...guest, body: "Realtime is in the room ✦" }),
	});
	await messages.awaitRows(
		(rows) => rows.some((row) => row.body === "Realtime is in the room ✦"),
		20_000,
	);

	await request<void>(`/api/rooms/${roomId}/leave`, {
		method: "POST",
		body: JSON.stringify(guest),
	});
	await request<void>(`/api/rooms/${roomId}/leave`, {
		method: "POST",
		body: JSON.stringify(host),
	});
	await lobby.awaitRows(
		(rows) => rows.every((row) => row.id !== roomId),
		20_000,
	);

	process.stdout.write(
		`Realtime smoke passed: playback, presence, chat, and empty-room removal converged in room ${roomId}.\n`,
	);
} finally {
	client.close();
	await sql`DELETE FROM watch_rooms WHERE id = ${roomId}`;
}
