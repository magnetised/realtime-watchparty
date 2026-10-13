import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const envPath = resolve(packageRoot, ".env.local");

if (existsSync(envPath)) process.loadEnvFile(envPath);
