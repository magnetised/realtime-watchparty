import type { LiveQueryState, RealtimeClient } from "@neon/realtime/client";
import { createRealtimeClient } from "@neon/realtime/client";
import { RealtimeProvider } from "@neon/realtime-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, serverNow } from "./api";
import { LiveRows } from "./live-rows";
import { SyncedPlayer } from "./player";
import type {
	ChatMessage,
	LobbyRoom,
	Person,
	RoomState,
	VideoResult,
	Viewer,
} from "./types";

function navigate(path: string): void {
	window.history.pushState({}, "", path);
	window.dispatchEvent(new PopStateEvent("popstate"));
	window.scrollTo({ top: 0, behavior: "smooth" });
}

function usePath(): string {
	const [path, setPath] = useState(window.location.pathname);
	useEffect(() => {
		const update = () => setPath(window.location.pathname);
		window.addEventListener("popstate", update);
		return () => window.removeEventListener("popstate", update);
	}, []);
	return path;
}

function savedPerson(): Person | undefined {
	const name = localStorage.getItem("watchhouse:name")?.trim();
	let userId = localStorage.getItem("watchhouse:user-id");
	if (!userId) {
		userId = crypto.randomUUID();
		localStorage.setItem("watchhouse:user-id", userId);
	}
	return name ? { name, userId } : undefined;
}

export function App() {
	const [person, setPerson] = useState<Person | undefined>(savedPerson);
	const [client, setClient] = useState<RealtimeClient>();
	const [bootError, setBootError] = useState<string>();
	const path = usePath();

	useEffect(() => {
		let active = true;
		let next: RealtimeClient | undefined;
		void api
			.config()
			.then(({ realtimeUrl }) => {
				next = createRealtimeClient({
					url: realtimeUrl,
					logLevel: "warn",
				});
				if (active) setClient(next);
				else next.close();
			})
			.catch((reason: unknown) => {
				if (active) {
					setBootError(
						reason instanceof Error
							? reason.message
							: "Could not start the app",
					);
				}
			});
		return () => {
			active = false;
			next?.close();
		};
	}, []);

	if (!person) {
		return (
			<NameGate
				onContinue={(name) => {
					const userId = crypto.randomUUID();
					localStorage.setItem("watchhouse:name", name);
					localStorage.setItem("watchhouse:user-id", userId);
					setPerson({ name, userId });
				}}
			/>
		);
	}

	if (bootError) return <Fatal message={bootError} />;
	if (!client) return <AppLoading />;

	const roomMatch = path.match(/^\/room\/([0-9a-f-]+)$/i);
	return (
		<RealtimeProvider client={client}>
			<div className="app-shell">
				<Header
					person={person}
					onChangeName={() => {
						localStorage.removeItem("watchhouse:name");
						setPerson(undefined);
					}}
				/>
				{roomMatch ? (
					<RoomPage
						key={roomMatch[1]}
						roomId={roomMatch[1]}
						person={person}
					/>
				) : (
					<HomePage person={person} />
				)}
			</div>
		</RealtimeProvider>
	);
}

function NameGate({ onContinue }: { onContinue: (name: string) => void }) {
	const [name, setName] = useState("");
	return (
		<main className="name-gate">
			<div className="ambient ambient-one" />
			<div className="ambient ambient-two" />
			<section className="gate-card">
				<Brand />
				<div className="gate-art" aria-hidden="true">
					<div className="gate-screen">
						<span>▶</span>
					</div>
					<div className="avatar-stack">
						<i>J</i>
						<i>M</i>
						<i>+</i>
					</div>
				</div>
				<p className="eyebrow">Pull up a seat</p>
				<h1>Good videos are better together.</h1>
				<p className="gate-copy">
					Join live rooms, stay on the same second, and talk without
					leaving the couch.
				</p>
				<form
					className="name-form"
					onSubmit={(event) => {
						event.preventDefault();
						const clean = name
							.trim()
							.replaceAll(/\s+/g, " ")
							.slice(0, 32);
						if (clean) onContinue(clean);
					}}
				>
					<label htmlFor="display-name">
						What should we call you?
					</label>
					<div className="input-action">
						<input
							id="display-name"
							maxLength={32}
							placeholder="Your name"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
						<button type="submit" disabled={!name.trim()}>
							Come on in <span>→</span>
						</button>
					</div>
				</form>
				<p className="powered">
					<NeonMark /> Presence, playback, and chat powered by Neon
					Realtime
				</p>
			</section>
		</main>
	);
}

function Header({
	person,
	onChangeName,
}: {
	person: Person;
	onChangeName: () => void;
}) {
	return (
		<header className="header">
			<button
				type="button"
				className="brand-button"
				onClick={() => navigate("/")}
			>
				<Brand />
			</button>
			<div className="header-right">
				<span className="realtime-indicator">
					<i /> Live on Neon Realtime
				</span>
				<button
					type="button"
					className="person-chip"
					onClick={onChangeName}
					title="Change name"
				>
					<span>{initials(person.name)}</span>
					{person.name}
				</button>
			</div>
		</header>
	);
}

function HomePage({ person }: { person: Person }) {
	return (
		<main className="home">
			<section className="hero">
				<div>
					<p className="eyebrow">Your shared screen</p>
					<h1>
						What are we
						<br />
						<em>watching?</em>
					</h1>
					<p>
						Find a video, start a room, and everyone lands on
						exactly the same moment.
					</p>
				</div>
				<div className="hero-orbit" aria-hidden="true">
					<div className="orbit-card orbit-back">
						<span>02:14</span>
					</div>
					<div className="orbit-card orbit-front">
						<b>▶</b>
						<span>Everyone’s in sync</span>
					</div>
					<i className="orbit-avatar a1">A</i>
					<i className="orbit-avatar a2">S</i>
					<i className="orbit-avatar a3">K</i>
				</div>
			</section>

			<section className="section live-section">
				<div className="section-heading">
					<div>
						<p className="eyebrow">
							<span className="live-dot" /> Happening now
						</p>
						<h2>Join the room</h2>
					</div>
					<p>Drop in. We’ll catch you up.</p>
				</div>
				<LiveRows<LobbyRoom>
					endpoint="/api/realtime/lobby"
					loading={<RoomSkeletons />}
				>
					{({ rows, status, error }) => (
						<>
							{status === "stale" && (
								<InlineStatus>
									Reconnecting with the live rooms…
								</InlineStatus>
							)}
							{error && (
								<InlineStatus error>
									{error.message}
								</InlineStatus>
							)}
							{rows.length ? (
								<div className="room-grid">
									{rows.map((room) => (
										<RoomCard key={room.id} room={room} />
									))}
								</div>
							) : !error ? (
								<div className="empty-rooms">
									<span>◎</span>
									<h3>The room is quiet</h3>
									<p>
										Pick something below and be the first to
										press play.
									</p>
								</div>
							) : null}
						</>
					)}
				</LiveRows>
			</section>

			<Discover person={person} />
		</main>
	);
}

function RoomCard({ room }: { room: LobbyRoom }) {
	const currentPosition =
		Number(room.position_seconds) +
		(room.playback_state === "playing"
			? Math.max(
					0,
					(serverNow() - new Date(room.state_changed_at).getTime()) /
						1_000,
				)
			: 0);
	return (
		<button
			className="room-card"
			type="button"
			onClick={() => navigate(`/room/${room.id}`)}
		>
			<div className="thumb-wrap">
				<img src={room.thumbnail_url} alt="" />
				<span className="playing-badge">
					<i />{" "}
					{room.playback_state === "playing" ? "Playing" : "Paused"}
				</span>
				<span className="time-badge">
					{formatTime(currentPosition)}
				</span>
				<div className="join-overlay">
					<span>Join them →</span>
				</div>
			</div>
			<div className="room-card-copy">
				<h3>{room.title}</h3>
				<div>
					<span className="mini-avatar">
						{initials(room.created_by)}
					</span>
					<p>
						<b>{room.created_by}</b> started this room
					</p>
				</div>
				<p className="watching-count">
					<span>◉</span> {room.viewer_count}{" "}
					{room.viewer_count === 1 ? "person" : "people"} watching
				</p>
			</div>
		</button>
	);
}

function Discover({ person }: { person: Person }) {
	const [query, setQuery] = useState("");
	const [submitted, setSubmitted] = useState("");
	const [videos, setVideos] = useState<VideoResult[]>([]);
	const [loading, setLoading] = useState(true);
	const [fallback, setFallback] = useState(false);
	const [error, setError] = useState<string>();
	const [starting, setStarting] = useState<string>();

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setError(undefined);
		void api
			.search(submitted, controller.signal)
			.then((result) => {
				setVideos(result.items);
				setFallback(result.fallback);
			})
			.catch((reason: unknown) => {
				if (!controller.signal.aborted)
					setError(
						reason instanceof Error
							? reason.message
							: "Search failed",
					);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [submitted]);

	async function start(video: VideoResult): Promise<void> {
		setStarting(video.id);
		setError(undefined);
		try {
			const { id } = await api.createRoom(person, video);
			navigate(`/room/${id}`);
		} catch (reason) {
			setError(
				reason instanceof Error
					? reason.message
					: "Could not start the room",
			);
			setStarting(undefined);
		}
	}

	return (
		<section className="section discover-section">
			<div className="discover-header">
				<div>
					<p className="eyebrow">Start something new</p>
					<h2>Pick the next watch</h2>
				</div>
				<form
					className="search"
					onSubmit={(event) => {
						event.preventDefault();
						setSubmitted(query.trim());
					}}
				>
					<span>⌕</span>
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search YouTube or paste a link"
						aria-label="Search YouTube"
					/>
					<button type="submit">Search</button>
				</form>
			</div>
			{fallback && submitted && (
				<p className="catalogue-note">
					The public search service is unavailable, so here are our
					house picks. You can still paste any YouTube URL.
				</p>
			)}
			{error && <InlineStatus error>{error}</InlineStatus>}
			{loading ? (
				<VideoSkeletons />
			) : (
				<div className="video-grid">
					{videos.map((video) => (
						<article className="video-card" key={video.id}>
							<div className="video-thumb">
								<img src={video.thumbnail} alt="" />
								{video.duration && (
									<span>{formatTime(video.duration)}</span>
								)}
								<button
									type="button"
									disabled={starting !== undefined}
									onClick={() => void start(video)}
								>
									{starting === video.id
										? "Starting…"
										: "Start a party"}
								</button>
							</div>
							<h3>{video.title}</h3>
							<p>{video.channel}</p>
						</article>
					))}
				</div>
			)}
		</section>
	);
}

function RoomPage({ roomId, person }: { roomId: string; person: Person }) {
	usePresence(roomId, person);
	return (
		<main className="room-page">
			<button
				type="button"
				className="back-link"
				onClick={() => navigate("/")}
			>
				← All watch parties
			</button>
			<LiveRows<RoomState>
				endpoint={`/api/realtime/rooms/${roomId}/state`}
				loading={<RoomPageSkeleton />}
			>
				{({ rows, status, error }) => {
					const room = rows[0];
					if (error) return <Fatal message={error.message} compact />;
					if (!room)
						return status === "live" ? (
							<Fatal message="This room doesn’t exist." compact />
						) : (
							<RoomPageSkeleton />
						);
					return (
						<RoomContent
							roomId={roomId}
							person={person}
							room={room}
							status={status}
						/>
					);
				}}
			</LiveRows>
		</main>
	);
}

function RoomContent({
	roomId,
	person,
	room,
	status,
}: {
	roomId: string;
	person: Person;
	room: RoomState;
	status: LiveQueryState["status"];
}) {
	const [playbackError, setPlaybackError] = useState<string>();
	const updatePlayback = async (
		state: "playing" | "paused",
		position: number,
	) => {
		try {
			await api.playback(roomId, person, state, position);
			setPlaybackError(undefined);
		} catch (reason) {
			setPlaybackError(
				reason instanceof Error
					? reason.message
					: "Could not sync playback",
			);
		}
	};
	return (
		<>
			<div className="room-title-row">
				<div>
					<p className="eyebrow">
						<span className="live-dot" /> Watch party
					</p>
					<h1>{room.title}</h1>
					<p>Started by {room.created_by}</p>
				</div>
				<StatusBadge status={status} />
			</div>
			{playbackError && (
				<InlineStatus error>{playbackError}</InlineStatus>
			)}
			<div className="watch-layout">
				<section className="watch-main">
					<SyncedPlayer
						room={room}
						person={person}
						onPlayback={updatePlayback}
					/>
					<div className="room-note">
						<NeonMark />
						<p>
							<b>Everyone sees the same moment.</b>
							<br />
							Play, pause, or seek and Neon Realtime brings the
							whole room with you.
						</p>
					</div>
				</section>
				<RoomSidebar roomId={roomId} person={person} />
			</div>
		</>
	);
}

function RoomSidebar({ roomId, person }: { roomId: string; person: Person }) {
	const [message, setMessage] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string>();
	const bottomRef = useRef<HTMLDivElement>(null);
	return (
		<aside className="room-sidebar">
			<LiveRows<Viewer>
				endpoint={`/api/realtime/rooms/${roomId}/viewers`}
			>
				{({ rows }) => <ViewerBar viewers={rows} person={person} />}
			</LiveRows>
			<div className="chat-heading">
				<div>
					<span>Chat</span>
					<i>Live</i>
				</div>
				<span>Be kind. It’s movie night.</span>
			</div>
			<LiveRows<ChatMessage>
				endpoint={`/api/realtime/rooms/${roomId}/messages`}
			>
				{({ rows, error: liveError }) => (
					<div className="messages">
						{liveError && (
							<InlineStatus error>
								{liveError.message}
							</InlineStatus>
						)}
						{rows.length === 0 && (
							<div className="empty-chat">
								<span>✦</span>
								<p>Say hello to the room</p>
							</div>
						)}
						{rows.map((item, index) => {
							const own = item.user_id === person.userId;
							const previous = rows[index - 1];
							const grouped = previous?.user_id === item.user_id;
							return (
								<div
									className={`message ${own ? "own" : ""} ${grouped ? "grouped" : ""}`}
									key={item.id}
								>
									{!grouped && (
										<span className="message-avatar">
											{initials(item.name)}
										</span>
									)}
									<div>
										{!grouped && (
											<p>
												<b>{own ? "You" : item.name}</b>
												<time>
													{formatClock(
														item.created_at,
													)}
												</time>
											</p>
										)}
										<span>{item.body}</span>
									</div>
								</div>
							);
						})}
						<div ref={bottomRef} />
					</div>
				)}
			</LiveRows>
			<form
				className="chat-form"
				onSubmit={(event) => {
					event.preventDefault();
					const body = message.trim();
					if (!body || sending) return;
					setSending(true);
					setError(undefined);
					void api
						.message(roomId, person, body)
						.then(() => {
							setMessage("");
							bottomRef.current?.scrollIntoView({
								behavior: "smooth",
							});
						})
						.catch((reason: unknown) =>
							setError(
								reason instanceof Error
									? reason.message
									: "Could not send",
							),
						)
						.finally(() => setSending(false));
				}}
			>
				{error && <p className="form-error">{error}</p>}
				<div>
					<input
						maxLength={500}
						value={message}
						onChange={(event) => setMessage(event.target.value)}
						placeholder="Message the room…"
					/>
					<button
						type="submit"
						disabled={!message.trim() || sending}
						aria-label="Send message"
					>
						↑
					</button>
				</div>
			</form>
		</aside>
	);
}

function ViewerBar({
	viewers,
	person,
}: {
	viewers: readonly Viewer[];
	person: Person;
}) {
	const active = useMemo(
		() =>
			viewers.filter(
				(viewer) =>
					Date.now() - new Date(viewer.last_seen_at).getTime() <
					35_000,
			),
		[viewers],
	);
	return (
		<div className="viewer-bar">
			<div className="viewer-avatars">
				{active.slice(0, 5).map((viewer, index) => (
					<span
						key={viewer.user_id}
						style={{ zIndex: 6 - index }}
						title={viewer.name}
					>
						{initials(viewer.name)}
					</span>
				))}
			</div>
			<div>
				<b>{active.length} watching</b>
				<p>
					{active
						.map((viewer) =>
							viewer.user_id === person.userId
								? "You"
								: viewer.name,
						)
						.slice(0, 3)
						.join(", ")}
					{active.length > 3 ? ` +${active.length - 3}` : ""}
				</p>
			</div>
		</div>
	);
}

function usePresence(roomId: string, person: Person): void {
	useEffect(() => {
		const beat = () => void api.join(roomId, person).catch(() => undefined);
		beat();
		const interval = window.setInterval(beat, 10_000);
		const leave = () =>
			void api.leave(roomId, person, true).catch(() => undefined);
		window.addEventListener("pagehide", leave);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("pagehide", leave);
			leave();
		};
	}, [person, roomId]);
}

function StatusBadge({ status }: { status: LiveQueryState["status"] }) {
	return (
		<span className={`status-badge ${status}`}>
			<i />
			{status === "live"
				? "In sync"
				: status === "stale"
					? "Catching up"
					: "Connecting"}
		</span>
	);
}

function InlineStatus({
	children,
	error = false,
}: {
	children: ReactNode;
	error?: boolean;
}) {
	return (
		<div className={`inline-status ${error ? "error" : ""}`}>
			{error ? "!" : "↻"} {children}
		</div>
	);
}

function Brand() {
	return (
		<span className="brand">
			<span className="brand-mark">
				<i />
				<i />
				<i />
			</span>
			<b>watchhouse</b>
		</span>
	);
}

function NeonMark() {
	return (
		<span className="neon-mark" aria-hidden="true">
			<i />
			<i />
		</span>
	);
}

function AppLoading() {
	return (
		<main className="app-loading">
			<Brand />
			<span className="spinner" />
			<p>Opening the house…</p>
		</main>
	);
}

function Fatal({
	message,
	compact = false,
}: {
	message: string;
	compact?: boolean;
}) {
	return (
		<main className={compact ? "fatal compact" : "fatal"}>
			<span>!</span>
			<h2>We lost the picture</h2>
			<p>{message}</p>
			<button type="button" onClick={() => navigate("/")}>
				Back to the lobby
			</button>
		</main>
	);
}

function RoomSkeletons() {
	return (
		<div className="room-grid">
			{[1, 2, 3].map((item) => (
				<div className="skeleton room-skeleton" key={item} />
			))}
		</div>
	);
}

function VideoSkeletons() {
	return (
		<div className="video-grid">
			{[1, 2, 3, 4, 5, 6].map((item) => (
				<div className="skeleton video-skeleton" key={item} />
			))}
		</div>
	);
}

function RoomPageSkeleton() {
	return (
		<div className="room-page-skeleton">
			<div className="skeleton title-skeleton" />
			<div className="watch-layout">
				<div className="skeleton player-skeleton" />
				<div className="skeleton sidebar-skeleton" />
			</div>
		</div>
	);
}

function initials(name: string): string {
	return name
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0]?.toLocaleUpperCase())
		.join("");
}

function formatTime(value: number): string {
	const seconds = Math.max(0, Math.floor(value));
	const hours = Math.floor(seconds / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	const rest = seconds % 60;
	return hours
		? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
		: `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatClock(value: Date): string {
	return new Date(value).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
}
