interface Window {
	YT?: {
		Player: new (
			element: HTMLElement,
			options: {
				host?: string;
				videoId: string;
				playerVars?: Record<string, string | number>;
				events: {
					onReady: (event: { target: YouTubePlayer }) => void;
					onStateChange: (event: {
						data: number;
						target: YouTubePlayer;
					}) => void;
					onError: (event: { data: number }) => void;
				};
			},
		) => YouTubePlayer;
		PlayerState: {
			ENDED: 0;
			PLAYING: 1;
			PAUSED: 2;
		};
	};
	onYouTubeIframeAPIReady?: () => void;
}

interface YouTubePlayer {
	destroy(): void;
	getCurrentTime(): number;
	getPlayerState(): number;
	pauseVideo(): void;
	playVideo(): void;
	seekTo(seconds: number, allowSeekAhead: boolean): void;
}
