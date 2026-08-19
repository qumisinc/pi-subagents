import { test } from "node:test";
import assert from "node:assert/strict";
import {
	parseChildThinkingEvent,
	getSubagentLifecycleCallbacks,
	setSubagentLifecycleCallbacks,
} from "../../src/shared/lifecycle-types.ts";

// Reasoning arrives on a child's stdout as `message_update` wrapping the provider's delta stream.

function update(inner: Record<string, unknown>): unknown {
	return { type: "message_update", assistantMessageEvent: inner };
}

test("classifies a thinking delta", () => {
	const result = parseChildThinkingEvent(
		update({ type: "thinking_delta", contentIndex: 0, delta: "the policy " }),
	);
	assert.deepEqual(result, { kind: "delta", contentIndex: 0, delta: "the policy " });
});

test("classifies a thinking end with its full text", () => {
	const result = parseChildThinkingEvent(
		update({ type: "thinking_end", contentIndex: 2, content: "complete block" }),
	);
	assert.deepEqual(result, { kind: "end", contentIndex: 2, content: "complete block" });
});

test("tolerates a thinking end with no content", () => {
	const result = parseChildThinkingEvent(update({ type: "thinking_end", contentIndex: 0 }));
	assert.deepEqual(result, { kind: "end", contentIndex: 0, content: "" });
});

test("ignores text deltas — the visible answer must not reach the reasoning channel", () => {
	assert.equal(
		parseChildThinkingEvent(update({ type: "text_delta", contentIndex: 0, delta: "answer" })),
		null,
	);
});

test("ignores other assistant stream events", () => {
	for (const type of ["thinking_start", "toolcall_start", "toolcall_delta", "text_end", "done"]) {
		assert.equal(parseChildThinkingEvent(update({ type, contentIndex: 0 })), null, type);
	}
});

test("ignores non-message_update events", () => {
	assert.equal(parseChildThinkingEvent({ type: "message_end", message: {} }), null);
	assert.equal(parseChildThinkingEvent({ type: "tool_execution_start", toolName: "Read" }), null);
});

test("rejects malformed shapes rather than emitting a partial event", () => {
	assert.equal(parseChildThinkingEvent(null), null);
	assert.equal(parseChildThinkingEvent("a string"), null);
	assert.equal(parseChildThinkingEvent({ type: "message_update" }), null);
	// No contentIndex — a host could not attribute this to a block.
	assert.equal(parseChildThinkingEvent(update({ type: "thinking_delta", delta: "x" })), null);
	// Non-string delta.
	assert.equal(
		parseChildThinkingEvent(update({ type: "thinking_delta", contentIndex: 0, delta: 42 })),
		null,
	);
	// contentIndex must be a non-negative integer — a NaN or negative index
	// can't address a block, and NaN in particular breaks in-place growth on a
	// host that looks blocks up by content index (NaN !== NaN).
	assert.equal(
		parseChildThinkingEvent(update({ type: "thinking_delta", contentIndex: NaN, delta: "x" })),
		null,
	);
	assert.equal(
		parseChildThinkingEvent(update({ type: "thinking_delta", contentIndex: -1, delta: "x" })),
		null,
	);
	assert.equal(
		parseChildThinkingEvent(update({ type: "thinking_delta", contentIndex: 1.5, delta: "x" })),
		null,
	);
});

test("the new callbacks round-trip through the global registry", () => {
	const previous = getSubagentLifecycleCallbacks();
	try {
		const deltas: Array<{ contentIndex: number; delta: string }> = [];
		const ends: Array<{ contentIndex: number; content: string }> = [];
		setSubagentLifecycleCallbacks({
			onChildThinkingDelta: (_toolCallId, _agentName, d) => deltas.push(d),
			onChildThinkingEnd: (_toolCallId, _agentName, b) => ends.push(b),
		});

		const callbacks = getSubagentLifecycleCallbacks();
		callbacks?.onChildThinkingDelta?.("tc1", "Cyber Liability", { contentIndex: 0, delta: "hi" });
		callbacks?.onChildThinkingEnd?.("tc1", "Cyber Liability", { contentIndex: 0, content: "hi there" });

		assert.deepEqual(deltas, [{ contentIndex: 0, delta: "hi" }]);
		assert.deepEqual(ends, [{ contentIndex: 0, content: "hi there" }]);
	} finally {
		setSubagentLifecycleCallbacks(previous);
	}
});

test("a host that registers neither reasoning callback still works", () => {
	const previous = getSubagentLifecycleCallbacks();
	try {
		setSubagentLifecycleCallbacks({ onChildStarted: () => {} });
		const callbacks = getSubagentLifecycleCallbacks();
		// Optional-call syntax is what execution.ts relies on; assert it is safe.
		callbacks?.onChildThinkingDelta?.("tc1", "agent", { contentIndex: 0, delta: "x" });
		callbacks?.onChildThinkingEnd?.("tc1", "agent", { contentIndex: 0, content: "x" });
	} finally {
		setSubagentLifecycleCallbacks(previous);
	}
});
