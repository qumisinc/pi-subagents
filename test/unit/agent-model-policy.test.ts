import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { discoverAgents, discoverAgentsAll } from "../../src/agents/agents.ts";

let tempHome = "";
let tempProject = "";
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function writeProjectSettings(value: unknown): void {
	writeJson(path.join(tempProject, ".pi", "settings.json"), value);
}

function writeProjectAgent(name: string, frontmatter: string): void {
	const filePath = path.join(tempProject, ".pi", "agents", `${name}.md`);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `---\nname: ${name}\ndescription: ${name} agent\n${frontmatter}---\n\nBody.\n`, "utf-8");
}

function findAgent(name: string) {
	return discoverAgents(tempProject, "both").agents.find((agent) => agent.name === name);
}

describe("subagent model config: overrides and the model floor across scopes", () => {
	beforeEach(() => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-policy-home-"));
		tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "pi-policy-project-"));
		process.env.HOME = tempHome;
		process.env.USERPROFILE = tempHome;
		fs.mkdirSync(path.join(tempProject, ".pi"), { recursive: true });
	});

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalUserProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = originalUserProfile;
		fs.rmSync(tempHome, { recursive: true, force: true });
		fs.rmSync(tempProject, { recursive: true, force: true });
	});

	// The bug this whole change exists for: project agents (Rails-injected
	// specialists) were unreachable by agentOverrides, so they spawned with no
	// --model and the child Pi CLI picked its own default.
	it("applies agentOverrides to project agents, not just builtins", () => {
		writeProjectAgent("Cyber Liability", "");
		writeProjectSettings({
			subagents: { agentOverrides: { "Cyber Liability": { model: "google/gemini-3.6-flash" } } },
		});

		const specialist = findAgent("Cyber Liability");
		assert.ok(specialist);
		assert.equal(specialist.source, "project");
		assert.equal(specialist.model, "google/gemini-3.6-flash");
		assert.equal(specialist.override?.scope, "project");
	});

	it("applies agentOverrides to user agents", () => {
		const userAgentPath = path.join(tempHome, ".agents", "helper.md");
		fs.mkdirSync(path.dirname(userAgentPath), { recursive: true });
		fs.writeFileSync(userAgentPath, "---\nname: helper\ndescription: helper\n---\n\nBody.\n", "utf-8");
		writeJson(path.join(tempHome, ".pi", "agent", "settings.json"), {
			subagents: { agentOverrides: { helper: { model: "google/gemini-3.6-flash" } } },
		});

		const helper = findAgent("helper");
		assert.ok(helper);
		assert.equal(helper.model, "google/gemini-3.6-flash");
		assert.equal(helper.override?.scope, "user");
	});

	it("project override beats user override for a project agent", () => {
		writeProjectAgent("Marine", "");
		writeJson(path.join(tempHome, ".pi", "agent", "settings.json"), {
			subagents: { agentOverrides: { Marine: { model: "user/from-user" } } },
		});
		writeProjectSettings({
			subagents: { agentOverrides: { Marine: { model: "project/from-project" } } },
		});

		assert.equal(findAgent("Marine")?.model, "project/from-project");
	});

	it("defaultModel fills agents with no model and never overwrites one", () => {
		writeProjectAgent("Surety", "");
		writeProjectAgent("Aviation", "model: google/gemini-3.1-pro-preview\n");
		writeProjectSettings({
			subagents: {
				defaultModel: "google/gemini-3.6-flash",
				agentOverrides: { scout: { model: "google/pinned-by-override" } },
			},
		});

		assert.equal(findAgent("Surety")?.model, "google/gemini-3.6-flash");
		// frontmatter model survives the floor
		assert.equal(findAgent("Aviation")?.model, "google/gemini-3.1-pro-preview");
		// named override survives the floor
		assert.equal(findAgent("scout")?.model, "google/pinned-by-override");
		// builtin with no model gets the floor
		assert.equal(findAgent("delegate")?.model, "google/gemini-3.6-flash");
	});

	it("project settings defaultModel wins over user settings defaultModel", () => {
		writeJson(path.join(tempHome, ".pi", "agent", "settings.json"), {
			subagents: { defaultModel: "google/from-user" },
		});
		writeProjectSettings({ subagents: { defaultModel: "google/from-project" } });

		assert.equal(findAgent("delegate")?.model, "google/from-project");
	});

	// Upstream contract: a project file shadowing a builtin name is a full
	// replacement, so the builtin's named override must not half-apply. The floor
	// still does, so the shadowing agent cannot fall through to a CLI default.
	it("skips named overrides for an agent shadowing a builtin, but still applies the floor", () => {
		writeProjectAgent("reviewer", "");
		writeProjectSettings({
			subagents: {
				defaultModel: "google/floor-model",
				agentOverrides: { reviewer: { model: "google/override-model" } },
			},
		});

		const reviewer = findAgent("reviewer");
		assert.equal(reviewer?.source, "project");
		assert.equal(reviewer?.override, undefined);
		assert.equal(reviewer?.model, "google/floor-model");
	});

	it("discoverAgentsAll reports effective models for every scope", () => {
		writeProjectAgent("Environmental", "");
		writeProjectSettings({ subagents: { defaultModel: "google/gemini-3.6-flash" } });

		const all = discoverAgentsAll(tempProject);
		assert.equal(all.project.find((agent) => agent.name === "Environmental")?.model, "google/gemini-3.6-flash");
		assert.equal(all.builtin.find((agent) => agent.name === "delegate")?.model, "google/gemini-3.6-flash");
	});

	it("a disabled project agent is filtered out via settings override", () => {
		writeProjectAgent("Retired Line", "");
		writeProjectSettings({ subagents: { agentOverrides: { "Retired Line": { disabled: true } } } });

		assert.equal(findAgent("Retired Line"), undefined);
	});

	// A malformed floor must mean "no floor", never a throw out of settings
	// parsing — that would make every agent undiscoverable and break dispatch
	// entirely, which is strictly worse than the misconfiguration it reports.
	it("ignores a malformed defaultModel instead of breaking agent discovery", () => {
		for (const subagents of [
			{ defaultModel: 5 },
			{ defaultModel: "   " },
			{ defaultModel: {} },
			{ defaultModel: [] },
		] as Record<string, unknown>[]) {
			writeProjectSettings({ subagents });
			const agents = discoverAgents(tempProject, "both").agents;
			assert.ok(agents.length > 0, `discovery returned nothing for ${JSON.stringify(subagents)}`);
		}
	});

	it("applies a valid defaultModel even when other keys are junk", () => {
		writeProjectSettings({
			subagents: { defaultModel: "google/floor", unknownKey: "not-an-array" },
		});
		const scout = discoverAgents(tempProject, "both").agents.find((a) => a.name === "scout");
		assert.equal(scout?.model, "google/floor");
	});
});
