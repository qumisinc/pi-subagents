import { createReadStream, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import * as path from "node:path";
import type { TokenUsage } from "./types.ts";

function findLatestSessionFile(sessionDir: string): string | null {
	try {
		const files = readdirSync(sessionDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => path.join(sessionDir, f));
		if (files.length === 0) return null;
		files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
		return files[0] ?? null;
	} catch {
		return null;
	}
}

export async function parseSessionTokens(sessionDir: string): Promise<TokenUsage | null> {
	const sessionFile = findLatestSessionFile(sessionDir);
	if (!sessionFile) return null;
	try {
		let input = 0;
		let output = 0;
		const rl = createInterface({
			input: createReadStream(sessionFile, "utf-8"),
			crlfDelay: Infinity,
		});
		for await (const line of rl) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				const usage = entry.usage ?? entry.message?.usage;
				if (usage) {
					input += usage.inputTokens ?? usage.input ?? 0;
					output += usage.outputTokens ?? usage.output ?? 0;
				}
			} catch {
				// Ignore malformed lines while scanning usage entries.
			}
		}
		return { input, output, total: input + output };
	} catch {
		return null;
	}
}
