import "./env.js";

export type VideoResult = {
	id: string;
	title: string;
	channel: string;
	thumbnail: string;
	duration?: number;
};

const CURATED_VIDEOS: readonly VideoResult[] = [
	{
		id: "jNQXAC9IVRw",
		title: "Me at the zoo",
		channel: "jawed",
		thumbnail: "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
		duration: 19,
	},
	{
		id: "aqz-KE-bpKQ",
		title: "Big Buck Bunny 60fps 4K",
		channel: "Blender",
		thumbnail: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
		duration: 634,
	},
	{
		id: "M7lc1UVf-VE",
		title: "YouTube Developers Live: Embedded Web Player Customization",
		channel: "Google for Developers",
		thumbnail: "https://i.ytimg.com/vi/M7lc1UVf-VE/hqdefault.jpg",
		duration: 89,
	},
	{
		id: "dQw4w9WgXcQ",
		title: "Rick Astley — Never Gonna Give You Up",
		channel: "Rick Astley",
		thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
		duration: 213,
	},
	{
		id: "ScMzIvxBSi4",
		title: "The first 20 hours — how to learn anything",
		channel: "TEDx Talks",
		thumbnail: "https://i.ytimg.com/vi/ScMzIvxBSi4/hqdefault.jpg",
		duration: 1176,
	},
	{
		id: "L_LUpnjgPso",
		title: "The art of misdirection",
		channel: "TED",
		thumbnail: "https://i.ytimg.com/vi/L_LUpnjgPso/hqdefault.jpg",
		duration: 527,
	},
];

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function extractVideoId(value: string): string | undefined {
	const trimmed = value.trim();
	if (VIDEO_ID.test(trimmed)) return trimmed;
	try {
		const url = new URL(trimmed);
		const candidate =
			url.hostname === "youtu.be"
				? url.pathname.slice(1).split("/")[0]
				: (url.searchParams.get("v") ??
					(url.pathname.startsWith("/shorts/")
						? url.pathname.split("/")[2]
						: undefined));
		return candidate && VIDEO_ID.test(candidate) ? candidate : undefined;
	} catch {
		return undefined;
	}
}

async function lookupVideo(id: string): Promise<VideoResult> {
	const response = await fetch(
		`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
		{ signal: AbortSignal.timeout(5_000) },
	);
	if (!response.ok)
		throw new Error(`YouTube oEmbed returned ${response.status}`);
	const item = (await response.json()) as {
		title: string;
		author_name: string;
		thumbnail_url: string;
	};
	return {
		id,
		title: item.title,
		channel: item.author_name,
		thumbnail: item.thumbnail_url,
	};
}

async function searchOfficial(query: string): Promise<VideoResult[]> {
	const key = process.env.YOUTUBE_API_KEY;
	if (!key) return [];
	const url = new URL("https://www.googleapis.com/youtube/v3/search");
	url.searchParams.set("part", "snippet");
	url.searchParams.set("type", "video");
	url.searchParams.set("videoEmbeddable", "true");
	url.searchParams.set("videoSyndicated", "true");
	url.searchParams.set("safeSearch", "moderate");
	url.searchParams.set("maxResults", "12");
	url.searchParams.set("q", query);
	url.searchParams.set("key", key);
	const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
	if (!response.ok)
		throw new Error(`YouTube Data API returned ${response.status}`);
	const payload = (await response.json()) as {
		items: Array<{
			id: { videoId: string };
			snippet: {
				title: string;
				channelTitle: string;
				thumbnails: {
					high?: { url: string };
					medium?: { url: string };
				};
			};
		}>;
	};
	return payload.items.map(({ id, snippet }) => ({
		id: id.videoId,
		title: snippet.title,
		channel: snippet.channelTitle,
		thumbnail:
			snippet.thumbnails.high?.url ??
			snippet.thumbnails.medium?.url ??
			`https://i.ytimg.com/vi/${id.videoId}/hqdefault.jpg`,
	}));
}

async function searchPiped(query: string): Promise<VideoResult[]> {
	const base =
		process.env.YOUTUBE_SEARCH_API_URL ?? "https://pipedapi.kavin.rocks";
	const url = new URL("/search", base);
	url.searchParams.set("q", query);
	url.searchParams.set("filter", "videos");
	const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
	if (!response.ok)
		throw new Error(`Video search returned ${response.status}`);
	const payload = (await response.json()) as {
		items?: Array<{
			url?: string;
			title?: string;
			uploaderName?: string;
			thumbnail?: string;
			duration?: number;
		}>;
	};
	return (payload.items ?? [])
		.map((item) => {
			const id = item.url
				? extractVideoId(`https://youtube.com${item.url}`)
				: undefined;
			if (!id || !item.title) return undefined;
			return {
				id,
				title: item.title,
				channel: item.uploaderName ?? "YouTube",
				thumbnail:
					item.thumbnail ??
					`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
				...(item.duration ? { duration: item.duration } : {}),
			};
		})
		.filter((item): item is VideoResult => item !== undefined)
		.slice(0, 12);
}

export async function discoverVideos(query: string): Promise<{
	items: VideoResult[];
	fallback: boolean;
}> {
	const trimmed = query.trim();
	if (!trimmed) return { items: [...CURATED_VIDEOS], fallback: false };

	const directId = extractVideoId(trimmed);
	if (directId) {
		try {
			return { items: [await lookupVideo(directId)], fallback: false };
		} catch {
			return {
				items: [
					{
						id: directId,
						title: "YouTube video",
						channel: "YouTube",
						thumbnail: `https://i.ytimg.com/vi/${directId}/hqdefault.jpg`,
					},
				],
				fallback: true,
			};
		}
	}

	try {
		const official = await searchOfficial(trimmed);
		const items = official.length ? official : await searchPiped(trimmed);
		if (items.length) return { items, fallback: false };
	} catch {
		// Fall through to the local catalogue so discovery remains useful offline.
	}

	const words = trimmed.toLocaleLowerCase().split(/\s+/);
	const matching = CURATED_VIDEOS.filter((video) =>
		words.every((word) =>
			`${video.title} ${video.channel}`
				.toLocaleLowerCase()
				.includes(word),
		),
	);
	return {
		items: matching.length ? matching : [...CURATED_VIDEOS],
		fallback: true,
	};
}
