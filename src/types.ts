export type LobbyRoom = {
	id: string;
	youtube_id: string;
	title: string;
	thumbnail_url: string;
	created_by: string;
	playback_state: "playing" | "paused";
	position_seconds: number;
	state_changed_at: Date;
	created_at: Date;
	updated_at: Date;
	viewer_count: number;
};

export type RoomState = {
	id: string;
	youtube_id: string;
	title: string;
	thumbnail_url: string;
	created_by: string;
	playback_state: "playing" | "paused";
	position_seconds: number;
	state_changed_at: Date;
};

export type Viewer = {
	user_id: string;
	name: string;
	joined_at: Date;
	last_seen_at: Date;
};

export type ChatMessage = {
	id: string;
	user_id: string;
	name: string;
	body: string;
	created_at: Date;
};

export type VideoResult = {
	id: string;
	title: string;
	channel: string;
	thumbnail: string;
	duration?: number;
};

export type Person = {
	userId: string;
	name: string;
};
