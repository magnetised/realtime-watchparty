import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import process from "node:process";
import { createRealtime, rawSql } from "@neon/realtime/server";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { databaseName, ensureSchema, sql } from "./db.js";
import { packageRoot } from "./env.js";
import { discoverVideos } from "./youtube.js";

const realtimeUrl = process.env.NEON_REALTIME_URL;
const realtimeSecret = process.env.NEON_REALTIME_SECRET;
if (!realtimeUrl || !realtimeSecret) {
	throw new Error(
		"NEON_REALTIME_URL and NEON_REALTIME_SECRET are required. Run `pnpm provision` first.",
	);
}

const realtime = createRealtime({
	secret: realtimeSecret,
	db: databaseName,
	debugMode: process.env.NODE_ENV !== "production",
});

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((_request, response, next) => {
	response.setHeader("x-watchhouse-time", Date.now().toString());
	next();
});

type AsyncHandler = (
	request: Request,
	response: Response,
	next: NextFunction,
) => Promise<unknown>;

const handle =
	(handler: AsyncHandler) =>
	(request: Request, response: Response, next: NextFunction): void => {
		void handler(request, response, next).catch(next);
	};

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function roomId(request: Request): string {
	const id = request.params.id;
	if (typeof id !== "string" || !UUID.test(id)) {
		throw new HttpError(400, "Invalid room id");
	}
	return id;
}

function cleanString(
	value: unknown,
	label: string,
	min: number,
	max: number,
): string {
	if (typeof value !== "string")
		throw new HttpError(400, `${label} is required`);
	const clean = value.trim().replaceAll(/\s+/g, " ");
	if (clean.length < min || clean.length > max) {
		throw new HttpError(400, `${label} must be ${min}–${max} characters`);
	}
	return clean;
}

function user(body: unknown): { userId: string; name: string } {
	const input = body as { userId?: unknown; name?: unknown };
	const userId = cleanString(input.userId, "User id", 36, 36);
	if (!UUID.test(userId)) throw new HttpError(400, "Invalid user id");
	return { userId, name: cleanString(input.name, "Name", 1, 32) };
}

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

app.get("/api/config", (_request, response) => {
	response.json({ realtimeUrl });
});

app.get(
	"/api/youtube/search",
	handle(async (request, response) => {
		const query =
			typeof request.query.q === "string"
				? request.query.q.slice(0, 200)
				: "";
		response.json(await discoverVideos(query));
	}),
);

app.post(
	"/api/rooms",
	handle(async (request, response) => {
		const person = user(request.body);
		const youtubeId = cleanString(
			request.body.youtubeId,
			"Video id",
			11,
			11,
		);
		if (!VIDEO_ID.test(youtubeId))
			throw new HttpError(400, "Invalid YouTube video id");
		const title = cleanString(request.body.title, "Title", 1, 180);
		const id = randomUUID();
		const thumbnail = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;

		await sql.transaction([
			sql`INSERT INTO watch_rooms (
				id, youtube_id, title, thumbnail_url, created_by, playback_state
			) VALUES (${id}, ${youtubeId}, ${title}, ${thumbnail}, ${person.name}, 'playing')`,
			sql`INSERT INTO watch_viewers (room_id, user_id, name)
				VALUES (${id}, ${person.userId}, ${person.name})`,
		]);
		response.status(201).json({ id });
	}),
);

app.post(
	"/api/rooms/:id/join",
	handle(async (request, response) => {
		const id = roomId(request);
		const person = user(request.body);
		await sql`INSERT INTO watch_viewers (room_id, user_id, name)
			VALUES (${id}, ${person.userId}, ${person.name})
			ON CONFLICT (room_id, user_id) DO UPDATE SET
				name = EXCLUDED.name,
				last_seen_at = clock_timestamp()`;
		response.status(204).end();
	}),
);

app.post(
	"/api/rooms/:id/leave",
	handle(async (request, response) => {
		const id = roomId(request);
		const person = user(request.body);
		await sql`DELETE FROM watch_viewers
			WHERE room_id = ${id} AND user_id = ${person.userId}`;
		response.status(204).end();
	}),
);

app.patch(
	"/api/rooms/:id/playback",
	handle(async (request, response) => {
		const id = roomId(request);
		user(request.body);
		const playbackState = request.body.state;
		const position = Number(request.body.position);
		if (playbackState !== "playing" && playbackState !== "paused") {
			throw new HttpError(
				400,
				"Playback state must be playing or paused",
			);
		}
		if (!Number.isFinite(position) || position < 0 || position > 86_400) {
			throw new HttpError(400, "Invalid playback position");
		}
		const result = await sql`UPDATE watch_rooms SET
				playback_state = ${playbackState},
				position_seconds = ${position},
				state_changed_at = clock_timestamp(),
				updated_at = clock_timestamp()
			WHERE id = ${id}
			RETURNING id`;
		if (result.length === 0) throw new HttpError(404, "Room not found");
		response.status(204).end();
	}),
);

app.post(
	"/api/rooms/:id/messages",
	handle(async (request, response) => {
		const id = roomId(request);
		const person = user(request.body);
		const body = cleanString(request.body.body, "Message", 1, 500);
		await sql`INSERT INTO watch_messages (room_id, user_id, name, body)
			VALUES (${id}, ${person.userId}, ${person.name}, ${body})`;
		response.status(201).json({ ok: true });
	}),
);

app.post(
	"/api/realtime/lobby",
	handle(async (_request, response) => {
		const query = rawSql(
			`SELECT
				r.id,
				r.youtube_id,
				r.title,
				r.thumbnail_url,
				r.created_by,
				r.playback_state,
				r.position_seconds,
				r.state_changed_at,
				r.created_at,
				r.updated_at,
				count(v.user_id)::int AS viewer_count
			FROM watch_rooms r
			LEFT JOIN watch_viewers v
				ON v.room_id = r.id
			GROUP BY r.id
			HAVING count(v.user_id) > 0
			ORDER BY r.updated_at DESC
			LIMIT 30`,
		);
		response.json(await realtime.seal({ query }));
	}),
);

app.post(
	"/api/realtime/rooms/:id/state",
	handle(async (request, response) => {
		const id = roomId(request);
		const query = rawSql(
			`SELECT
				id,
				youtube_id,
				title,
				thumbnail_url,
				created_by,
				playback_state,
				position_seconds,
				state_changed_at
			FROM watch_rooms
			WHERE id = $1`,
			[id],
		);
		response.json(await realtime.seal({ query }));
	}),
);

app.post(
	"/api/realtime/rooms/:id/viewers",
	handle(async (request, response) => {
		const id = roomId(request);
		const query = rawSql(
			`SELECT user_id, name, joined_at, last_seen_at
			FROM watch_viewers
			WHERE room_id = $1
			ORDER BY joined_at ASC`,
			[id],
		);
		response.json(await realtime.seal({ query }));
	}),
);

app.post(
	"/api/realtime/rooms/:id/messages",
	handle(async (request, response) => {
		const id = roomId(request);
		const query = rawSql(
			`SELECT id, user_id, name, body, created_at
			FROM (
				SELECT id, user_id, name, body, created_at
				FROM watch_messages
				WHERE room_id = $1
				ORDER BY created_at DESC
				LIMIT 200
			) recent
			ORDER BY created_at ASC`,
			[id],
		);
		response.json(await realtime.seal({ query }));
	}),
);

app.use(
	(
		error: unknown,
		_request: Request,
		response: Response,
		_next: NextFunction,
	) => {
		const status = error instanceof HttpError ? error.status : 500;
		const message =
			error instanceof Error ? error.message : "Unexpected error";
		if (status === 500) console.error(error);
		response.status(status).json({
			error: status === 500 ? "Unexpected server error" : message,
		});
	},
);

await ensureSchema();

const presenceCleanup = setInterval(() => {
	void sql`DELETE FROM watch_viewers
		WHERE last_seen_at < clock_timestamp() - interval '35 seconds'`.catch(
		(error: unknown) => console.error("Presence cleanup failed", error),
	);
}, 15_000);
presenceCleanup.unref();

if (process.env.NODE_ENV === "production") {
	const dist = resolve(packageRoot, "dist");
	app.use(express.static(dist));
	app.get("*path", (_request, response) =>
		response.sendFile(resolve(dist, "index.html")),
	);
} else {
	const { createServer: createViteServer } = await import("vite");
	const vite = await createViteServer({
		root: packageRoot,
		server: { middlewareMode: true },
		appType: "spa",
	});
	app.use(vite.middlewares);
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
	process.stdout.write(`Watchhouse is ready at http://localhost:${port}\n`);
});
