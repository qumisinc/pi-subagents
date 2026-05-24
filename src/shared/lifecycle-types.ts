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
