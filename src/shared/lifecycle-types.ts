export interface ProgressSnapshot {
	currentTool?: string;
	currentToolArgs?: string;
	currentPath?: string;
	toolCount: number;
	durationMs: number;
	lastActivityAt: number;
	recentTools: Array<{ tool: string; args: string; endMs: number }>;
	tokens: { input: number; output: number };
}

export interface SubagentLifecycleCallbacks {
	onChildStarted?: (
		toolCallId: string,
		agentName: string,
		sessionFilePath: string,
		opts: { index: number; runId: string },
	) => void;
	onChildActivity?: (
		toolCallId: string,
		agentName: string,
		progress: ProgressSnapshot,
	) => void;
	onChildCompleted?: (
		toolCallId: string,
		agentName: string,
		metaPath: string,
		opts: { index: number; runId: string },
	) => void;
	/**
	 * A child's reasoning, streamed as the model produces it.
	 *
	 * Children run as `pi --mode json -p`, whose stdout carries
	 * `message_update` events wrapping the provider's delta stream. Those
	 * deltas are already read in-process here; without this callback the only
	 * reasoning a host could observe was the completed block in the child's
	 * session file, which lands at turn boundaries — so a child that runs a
	 * single turn surfaced nothing until it finished.
	 *
	 * `contentIndex` identifies the thinking block within the child's message,
	 * so a host can grow the right block when a message has several. Fired once
	 * per delta; hosts are expected to coalesce before doing anything
	 * expensive with it.
	 */
	onChildThinkingDelta?: (
		toolCallId: string,
		agentName: string,
		delta: { contentIndex: number; delta: string },
	) => void;
	/**
	 * A child's reasoning block is complete, carrying its full text.
	 *
	 * Hosts that accumulated `onChildThinkingDelta` should replace their
	 * accumulated text with this — it is authoritative, so a dropped delta
	 * self-heals at the block boundary.
	 */
	onChildThinkingEnd?: (
		toolCallId: string,
		agentName: string,
		block: { contentIndex: number; content: string },
	) => void;
}

/** A reasoning event classified off a child's `message_update` stdout line. */
export type ChildThinkingEvent =
	| { kind: "delta"; contentIndex: number; delta: string }
	| { kind: "end"; contentIndex: number; content: string };

/**
 * Classify a parsed child stdout line as a reasoning event, or null if it is
 * anything else.
 *
 * Children emit `pi --mode json` events; reasoning arrives as `message_update`
 * wrapping an `assistantMessageEvent` of `thinking_delta` / `thinking_end`.
 * Text deltas, tool calls and lifecycle events all flow through the same
 * channel, so this deliberately matches narrowly — a host wiring these to a UI
 * must not receive the assistant's visible answer on the reasoning channel.
 */
export function parseChildThinkingEvent(evt: unknown): ChildThinkingEvent | null {
	if (!evt || typeof evt !== "object") return null;
	const outer = evt as { type?: unknown; assistantMessageEvent?: unknown };
	if (outer.type !== "message_update") return null;
	const inner = outer.assistantMessageEvent;
	if (!inner || typeof inner !== "object") return null;
	const { type, contentIndex, delta, content } = inner as {
		type?: unknown;
		contentIndex?: unknown;
		delta?: unknown;
		content?: unknown;
	};
	if (typeof contentIndex !== "number" || !Number.isInteger(contentIndex) || contentIndex < 0) return null;
	if (type === "thinking_delta" && typeof delta === "string") {
		return { kind: "delta", contentIndex, delta };
	}
	if (type === "thinking_end") {
		return { kind: "end", contentIndex, content: typeof content === "string" ? content : "" };
	}
	return null;
}

const GLOBAL_KEY = "__piSubagentLifecycleCallbacks";
const g = globalThis as Record<string, unknown>;

export function setSubagentLifecycleCallbacks(
	callbacks: SubagentLifecycleCallbacks | null | undefined,
): void {
	g[GLOBAL_KEY] = callbacks ?? null;
}

export function getSubagentLifecycleCallbacks(): SubagentLifecycleCallbacks | null {
	return (g[GLOBAL_KEY] as SubagentLifecycleCallbacks | null) ?? null;
}
