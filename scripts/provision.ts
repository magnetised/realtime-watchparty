import { writeFile } from "node:fs/promises";
import { createNeonClient } from "@neon/sdk";

const STAGING_API = "https://console-stage.neon.build/api/v2";
const apiKey = process.env.NEON_API_KEY;

if (!apiKey) {
	throw new Error(
		"Set NEON_API_KEY to a Neon staging API key before running this command.",
	);
}

const account = createNeonClient({
	apiKey,
	baseUrl: STAGING_API,
	throwOnError: true,
	wait: { pollIntervalMs: 1_500, timeoutMs: 180_000 },
});

const organizations = await account.user.organizations();
const orgId = process.env.NEON_ORG_ID ?? organizations[0]?.id;
if (!orgId) {
	throw new Error("The staging account does not belong to an organization.");
}
if (!process.env.NEON_ORG_ID && organizations.length > 1) {
	const choices = organizations
		.map((organization) => `${organization.name} (${organization.id})`)
		.join(", ");
	throw new Error(
		`This key can access multiple organizations. Set NEON_ORG_ID to one of: ${choices}`,
	);
}

const neon = createNeonClient({
	apiKey,
	baseUrl: STAGING_API,
	orgId,
	throwOnError: true,
	wait: { pollIntervalMs: 1_500, timeoutMs: 180_000 },
});

const suffix = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const { project, connectionString } = await neon.projects.createAndConnect({
	name: `watchparty-${suffix}`,
	branch: {
		name: "main",
		database_name: "watchparty",
		role_name: "watchparty_owner",
	},
	realtime: {
		allowed_origins: ["http://localhost:5173", "http://localhost:8787"],
	},
	pooled: false,
});

const branch = await neon.branches.getDefault({ projectId: project.id });
await neon.realtime.enable({
	projectId: project.id,
	branchId: branch.id,
	allowed_origins: ["http://localhost:5173", "http://localhost:8787"],
});

const state = await neon.realtime.get({
	projectId: project.id,
	branchId: branch.id,
});
const secret = await neon.realtime.secret({
	projectId: project.id,
	branchId: branch.id,
});

if (
	!state.enabled ||
	state.pending ||
	!state.invocation_url ||
	secret.pending
) {
	throw new Error("Realtime did not finish provisioning before the timeout.");
}

const env = [
	`DATABASE_URL=${connectionString}`,
	`NEON_REALTIME_URL=${state.invocation_url}`,
	`NEON_REALTIME_SECRET=${secret.secret}`,
	`NEON_PROJECT_ID=${project.id}`,
	`NEON_BRANCH_ID=${branch.id}`,
	"YOUTUBE_API_KEY=",
	"YOUTUBE_SEARCH_API_URL=https://pipedapi.kavin.rocks",
	"PORT=8787",
	"",
].join("\n");

await writeFile(new URL("../.env.local", import.meta.url), env, {
	mode: 0o600,
});

process.stdout.write(
	`Created staging project ${project.name} (${project.id}) and wrote .env.local.\n`,
);
