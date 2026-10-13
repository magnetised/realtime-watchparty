import type { SealedLiveQuery } from "@neon/realtime/client";
import type { Person, VideoResult } from "./types";

let serverClockOffsetMs = 0;

export function serverNow(): number {
	return Date.now() + serverClockOffsetMs;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const startedAt = Date.now();
	const response = await fetch(path, {
		...init,
		headers: {
			...(init?.body ? { "content-type": "application/json" } : {}),
			...init?.headers,
		},
	});
	const serverTime = Number(response.headers.get("x-watchhouse-time"));
	if (Number.isFinite(serverTime)) {
		serverClockOffsetMs = serverTime - (startedAt + Date.now()) / 2;
	}
	if (!response.ok) {
		const body = (await response.json().catch(() => undefined)) as
			| { error?: string }
			| undefined;
		throw new Error(body?.error ?? `Request failed (${response.status})`);
	}
	return response.status === 204
		? (undefined as T)
		: ((await response.json()) as T);
}

export const api = {
	config: () => request<{ realtimeUrl: string }>("/api/config"),
	seal: <Row>(path: string) =>
		request<SealedLiveQuery<Row>>(path, { method: "POST" }),
	search: (query: string, signal?: AbortSignal) =>
		request<{ items: VideoResult[]; fallback: boolean }>(
			`/api/youtube/search?q=${encodeURIComponent(query)}`,
			{ signal },
		),
	createRoom: (person: Person, video: VideoResult) =>
		request<{ id: string }>("/api/rooms", {
			method: "POST",
			body: JSON.stringify({
				...person,
				youtubeId: video.id,
				title: video.title,
			}),
		}),
	join: (roomId: string, person: Person) =>
		request<void>(`/api/rooms/${roomId}/join`, {
			method: "POST",
			body: JSON.stringify(person),
		}),
	leave: (roomId: string, person: Person, keepalive = false) =>
		request<void>(`/api/rooms/${roomId}/leave`, {
			method: "POST",
			body: JSON.stringify(person),
			keepalive,
		}),
	playback: (
		roomId: string,
		person: Person,
		state: "playing" | "paused",
		position: number,
	) =>
		request<void>(`/api/rooms/${roomId}/playback`, {
			method: "PATCH",
			body: JSON.stringify({ ...person, state, position }),
		}),
	message: (roomId: string, person: Person, body: string) =>
		request<{ ok: true }>(`/api/rooms/${roomId}/messages`, {
			method: "POST",
			body: JSON.stringify({ ...person, body }),
		}),
};
