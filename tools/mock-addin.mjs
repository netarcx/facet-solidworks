#!/usr/bin/env node
/**
 * mock-addin — a stand-in for the SolidWorks add-in's WebSocket server.
 *
 * Lets you exercise the full Stream Deck plugin (context switching, repaints, key feedback)
 * without SolidWorks. It plays the add-in's role: greets the plugin with `hello`, streams
 * `context` updates as you "move around SolidWorks", and acks `invoke`s with `result`.
 *
 *   node tools/mock-addin.mjs            # interactive: press keys to switch context
 *   node tools/mock-addin.mjs --auto     # cycle through contexts on a timer
 *
 * Interactive keys:  n=none  p=part  s=sketch  a=assembly  d=drawing  x=part+selection  q=quit
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";

const PORT = 8723;
const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(here, "..", "shared", "catalog.json"), "utf8"));

const SCENES = {
	n: { layout: "none", docType: "none", title: "" },
	p: { layout: "part", docType: "part", title: "bracket.SLDPRT" },
	s: { layout: "sketch", docType: "part", title: "bracket.SLDPRT", inSketch: true },
	a: { layout: "assembly", docType: "assembly", title: "gearbox.SLDASM" },
	d: { layout: "drawing", docType: "drawing", title: "bracket.SLDDRW" },
	x: { layout: "part.selection", docType: "part", title: "bracket.SLDPRT", selection: { count: 1, types: ["edge"] } },
};
const AUTO_ORDER = ["p", "s", "p", "x", "a", "d", "n"];

let current = "n";
const clients = new Set();

function contextMsg(key) {
	const s = SCENES[key] ?? SCENES.n;
	return {
		v: 1,
		type: "context",
		docType: s.docType,
		inSketch: Boolean(s.inSketch),
		activeCommand: null,
		selection: s.selection ?? { count: 0, types: [] },
		docTitle: s.title,
		layout: s.layout,
	};
}

function broadcastContext(key) {
	current = key;
	const msg = JSON.stringify(contextMsg(key));
	const label = (catalog.layouts[SCENES[key].layout]?.title) ?? SCENES[key].layout;
	console.log(`→ context: ${label}  (layout="${SCENES[key].layout}", ${clients.size} client${clients.size === 1 ? "" : "s"})`);
	for (const ws of clients) {
		if (ws.readyState === ws.OPEN) ws.send(msg);
	}
}

// No host → dual-stack loopback, so it accepts the plugin whether `localhost` resolves to
// 127.0.0.1 or ::1 (matches the real add-in, which binds the `localhost` HttpListener prefix).
const wss = new WebSocketServer({ port: PORT });

wss.on("listening", () => {
	console.log(`Facet mock add-in listening on ws://localhost:${PORT}`);
	console.log("Keys: n=none  p=part  s=sketch  a=assembly  d=drawing  x=part+selection  q=quit\n");
});

wss.on("connection", (ws) => {
	clients.add(ws);
	console.log(`✓ plugin connected (${clients.size} total)`);
	ws.send(JSON.stringify({ v: 1, type: "hello", app: "SolidWorks", appVersion: "2026 (mock)", port: PORT, protocol: 1, addinVersion: "0.0.0-mock" }));
	// Send the current scene shortly after greeting.
	setTimeout(() => ws.send(JSON.stringify(contextMsg(current))), 150);

	ws.on("message", (data) => {
		let msg;
		try {
			msg = JSON.parse(data.toString());
		} catch {
			return;
		}
		if (msg.type === "ready") {
			console.log(`  plugin ready (device=${msg.device}, v${msg.pluginVersion})`);
		} else if (msg.type === "invoke") {
			console.log(`  ⌨  invoke: ${msg.command ?? msg.commandId} (slot ${msg.slot}, layout "${msg.layout}")`);
			ws.send(JSON.stringify({ v: 1, type: "result", nonce: msg.nonce, ok: true, message: null }));
		}
	});

	ws.on("close", () => {
		clients.delete(ws);
		console.log(`✗ plugin disconnected (${clients.size} total)`);
	});
	ws.on("error", () => {});
});

wss.on("error", (err) => {
	console.error(`Mock server error: ${err.message}`);
	process.exit(1);
});

/* ---- Driving the scene ---- */

if (process.argv.includes("--auto")) {
	let i = 0;
	console.log("Auto mode: cycling contexts every 3s. Ctrl+C to stop.\n");
	broadcastContext(AUTO_ORDER[0]);
	setInterval(() => {
		i = (i + 1) % AUTO_ORDER.length;
		broadcastContext(AUTO_ORDER[i]);
	}, 3000);
} else if (process.stdin.isTTY) {
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (key) => {
		if (key === "q" || key === "") {
			console.log("\nBye.");
			process.exit(0);
		}
		if (SCENES[key]) broadcastContext(key);
	});
} else {
	console.log("(non-interactive stdin — pass --auto to cycle contexts)");
}
