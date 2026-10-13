import { useEffect, useRef, useState } from "react";
import { serverNow } from "./api";
import type { Person, RoomState } from "./types";

let youtubeApiPromise: Promise<void> | undefined;
const YOUTUBE_EMBED_HOST = "https://www.youtube-nocookie.com";

function playerErrorMessage(code: number): string {
	switch (code) {
		case 2:
			return "YouTube rejected this video id.";
		case 5:
			return "YouTube could not start HTML5 playback. Check browser media and content-blocking settings.";
		case 100:
			return "This video is unavailable or has been removed.";
		case 101:
		case 150:
			return "The owner of this video does not allow embedded playback.";
		case 153:
			return "YouTube rejected the embedded player request. Check browser privacy and referrer settings.";
		default:
			return `YouTube could not play this video (error ${code}).`;
	}
}

function loadYouTubeApi(): Promise<void> {
	if (window.YT?.Player) return Promise.resolve();
	if (youtubeApiPromise) return youtubeApiPromise;
	youtubeApiPromise = new Promise((resolve, reject) => {
		const previous = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			previous?.();
			resolve();
		};
		const script = document.createElement("script");
		script.src = "https://www.youtube.com/iframe_api";
		script.async = true;
		script.referrerPolicy = "strict-origin-when-cross-origin";
		script.onerror = () =>
			reject(new Error("Could not load the YouTube player"));
		document.head.append(script);
	});
	return youtubeApiPromise;
}

export function SyncedPlayer({
	room,
	person,
	onPlayback,
}: {
	room: RoomState;
	person: Person;
	onPlayback: (state: "playing" | "paused", position: number) => Promise<void>;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const playerRef = useRef<YouTubePlayer | null>(null);
	const roomRef = useRef(room);
	const suppressUntilRef = useRef(0);
	const playerFailedRef = useRef(false);
	const applyingRoomStateRef = useRef(false);
	const onPlaybackRef = useRef(onPlayback);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string>();
	const [needsResume, setNeedsResume] = useState(false);

	onPlaybackRef.current = onPlayback;

	useEffect(() => {
		roomRef.current = room;
	}, [room]);

	useEffect(() => {
		let active = true;
		void loadYouTubeApi()
			.then(() => {
				if (!active || !hostRef.current || !window.YT) return;
				playerFailedRef.current = false;
				applyingRoomStateRef.current = false;
				setError(undefined);
				setNeedsResume(false);
				playerRef.current = new window.YT.Player(hostRef.current, {
					host: YOUTUBE_EMBED_HOST,
					videoId: room.youtube_id,
					playerVars: {
						autoplay: 1,
						controls: 1,
						disablekb: 0,
						enablejsapi: 1,
						playsinline: 1,
						origin: window.location.origin,
						rel: 0,
					},
					events: {
						onReady: () => setReady(true),
						onError: ({ data }) => {
							playerFailedRef.current = true;
							suppressUntilRef.current = Number.POSITIVE_INFINITY;
							setError(playerErrorMessage(data));
						},
						onStateChange: ({ data, target }) => {
							if (playerFailedRef.current || !window.YT) return;
							if (data === window.YT.PlayerState.PLAYING) {
								setNeedsResume(false);
								if (applyingRoomStateRef.current) {
									applyingRoomStateRef.current = false;
									return;
								}
								if (performance.now() < suppressUntilRef.current) return;
								void onPlaybackRef.current("playing", target.getCurrentTime());
							} else if (
								data === window.YT.PlayerState.PAUSED ||
								data === window.YT.PlayerState.ENDED
							) {
								if (applyingRoomStateRef.current) {
									if (roomRef.current.playback_state === "playing") {
										setNeedsResume(true);
										return;
									}
									applyingRoomStateRef.current = false;
									return;
								}
								if (performance.now() < suppressUntilRef.current) return;
								void onPlaybackRef.current("paused", target.getCurrentTime());
							}
						},
					},
				});
			})
			.catch((reason: unknown) =>
				setError(
					reason instanceof Error ? reason.message : "Could not load YouTube",
				),
			);
		return () => {
			active = false;
			playerFailedRef.current = true;
			applyingRoomStateRef.current = false;
			playerRef.current?.destroy();
			playerRef.current = null;
		};
	}, [room.youtube_id]);

	useEffect(() => {
		const player = playerRef.current;
		if (!ready || !player) return;
		let autoplayCheck: number | undefined;
		const elapsed =
			room.playback_state === "playing"
				? Math.max(
						0,
						(serverNow() - new Date(room.state_changed_at).getTime()) / 1_000,
					)
				: 0;
		const target = Math.max(0, Number(room.position_seconds) + elapsed);
		const drift = Math.abs(player.getCurrentTime() - target);
		const state = player.getPlayerState();
		const stateMatches =
			room.playback_state === "playing"
				? state === window.YT?.PlayerState.PLAYING
				: state === window.YT?.PlayerState.PAUSED ||
					state === window.YT?.PlayerState.ENDED;
		if (drift <= 1.2 && stateMatches) return;
		applyingRoomStateRef.current = true;
		suppressUntilRef.current = performance.now() + 1_200;
		if (drift > 1.2) player.seekTo(target, true);
		if (room.playback_state === "playing") {
			player.playVideo();
			autoplayCheck = window.setTimeout(() => {
				if (
					playerRef.current === player &&
					roomRef.current.playback_state === "playing" &&
					player.getPlayerState() !== window.YT?.PlayerState.PLAYING
				) {
					setNeedsResume(true);
				}
			}, 1_500);
		} else {
			setNeedsResume(false);
			player.pauseVideo();
		}
		return () => {
			if (autoplayCheck !== undefined) window.clearTimeout(autoplayCheck);
		};
	}, [ready, room]);

	useEffect(() => {
		const interval = window.setInterval(() => {
			const player = playerRef.current;
			const current = roomRef.current;
			if (!player || current.playback_state !== "playing") return;
			const expected =
				Number(current.position_seconds) +
				Math.max(
					0,
					(serverNow() - new Date(current.state_changed_at).getTime()) / 1_000,
				);
			if (Math.abs(player.getCurrentTime() - expected) > 2.5) {
				suppressUntilRef.current = performance.now() + 1_200;
				player.seekTo(expected, true);
			}
		}, 2_000);
		return () => window.clearInterval(interval);
	}, []);

	return (
		<div className="player-shell">
			<div className="player-aspect" ref={hostRef} />
			{!ready && !error && (
				<div className="player-overlay">
					<span className="spinner" />
					Matching the room’s playback…
				</div>
			)}
			{ready && needsResume && !error && (
				<div className="player-overlay player-resume">
					<p>The room is playing, but your browser paused the video.</p>
					<button
						type="button"
						onClick={() => {
							const player = playerRef.current;
							if (!player) return;
							applyingRoomStateRef.current = true;
							suppressUntilRef.current = performance.now() + 1_200;
							setNeedsResume(false);
							player.playVideo();
							window.setTimeout(() => {
								if (
									playerRef.current === player &&
									player.getPlayerState() !== window.YT?.PlayerState.PLAYING
								) {
									setNeedsResume(true);
								}
							}, 1_500);
						}}
					>
						Resume at the live position
					</button>
				</div>
			)}
			{error && (
				<div className="player-overlay player-error">
					<p>{error}</p>
					<a
						href={`https://www.youtube.com/watch?v=${room.youtube_id}`}
						target="_blank"
						rel="noreferrer"
					>
						Open directly on YouTube
					</a>
				</div>
			)}
			<div className="sync-pill">
				<span /> Synced with {person.name}
			</div>
		</div>
	);
}
