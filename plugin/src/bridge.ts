/**
 * AddinBridge — the private link between this plugin and the SolidWorks add-in.
 *
 * The add-in is the WebSocket *server* (it owns the longer lifecycle and the source of truth);
 * this plugin is the client. We scan a small port range for a server that greets us with a
 * `hello`, then stream `context` updates in and send `invoke` out. Drops auto-reconnect.
 *
 * Connection is a single guarded state machine: at most one probe socket exists at a time, and
 * `start`/`kick`/reconnect all funnel through `#beginSweep`, so sweeps can't overlap or leak
 * sockets. We connect to `localhost` (not `127.0.0.1`) to match the add-in's HttpListener prefix.
 */
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { ContextMsg, InboundMsg, InvokeMsg, ResultMsg } from "./types";

const PRIMARY_PORT = 8723;
const PORT_RANGE = 11; // scan 8723..8733
const HELLO_TIMEOUT_MS = 800;
const RECONNECT_MS = 2000;
const INVOKE_TIMEOUT_MS = 12000; // we now wait for the real RunCommand result, which loads UI
const PLUGIN_VERSION = "0.2.2";

type PendingResolver = (r: ResultMsg) => void;

export interface BridgeEvents {
	connected: [];
	context: [ContextMsg];
	disconnected: [];
}

class AddinBridge extends EventEmitter {
	#socket: WebSocket | null = null; // the established, greeted connection
	#probe: WebSocket | null = null; // the socket currently being tried during a sweep
	#connected = false;
	#opening = false; // a sweep is in flight
	#stopped = true;
	#portIndex = 0;
	#reconnectTimer: NodeJS.Timeout | null = null;
	#helloTimer: NodeJS.Timeout | null = null;
	#nonce = 0;
	#pending = new Map<string, { resolve: PendingResolver; timer: NodeJS.Timeout }>();

	get isConnected(): boolean {
		return this.#connected;
	}

	/** Begin connecting (and keep reconnecting until stop()). */
	start(): void {
		if (!this.#stopped) return;
		this.#stopped = false;
		this.#beginSweep();
	}

	/** Trigger an immediate reconnection attempt (e.g. on system wake). */
	kick(): void {
		if (this.#stopped) {
			this.start();
			return;
		}
		if (!this.#connected) this.#beginSweep();
	}

	stop(): void {
		this.#stopped = true;
		this.#clearTimers();
		this.#opening = false;
		this.#teardown(this.#probe);
		this.#probe = null;
		this.#teardown(this.#socket);
		this.#socket = null;
		this.#connected = false;
		this.#failPending("Bridge stopped");
	}

	/** Send a command to SolidWorks; resolves with the add-in's result (or a timeout failure). */
	invoke(msg: Omit<InvokeMsg, "v" | "type" | "nonce">): Promise<ResultMsg> {
		const nonce = `n${++this.#nonce}-${Date.now()}`;
		const full: InvokeMsg = { v: 1, type: "invoke", nonce, ...msg };
		return new Promise<ResultMsg>((resolve) => {
			if (!this.#connected || !this.#socket) {
				resolve({ v: 1, type: "result", nonce, ok: false, message: "Not connected to SolidWorks" });
				return;
			}
			const timer = setTimeout(() => {
				this.#pending.delete(nonce);
				resolve({ v: 1, type: "result", nonce, ok: false, message: "SolidWorks did not respond" });
			}, INVOKE_TIMEOUT_MS);
			this.#pending.set(nonce, { resolve, timer });
			this.#send(this.#socket, full);
		});
	}

	/* ---- Connection state machine ---- */

	#beginSweep(): void {
		if (this.#stopped || this.#opening || this.#connected) return;
		this.#opening = true;
		this.#portIndex = 0;
		this.#openCurrent();
	}

	#openCurrent(): void {
		if (this.#stopped) {
			this.#opening = false;
			return;
		}
		if (this.#portIndex >= PORT_RANGE) {
			// Swept the whole range with no server — back off, then sweep again.
			this.#opening = false;
			this.#scheduleReconnect();
			return;
		}

		const port = PRIMARY_PORT + this.#portIndex;
		const ws = new WebSocket(`ws://localhost:${port}`);
		this.#probe = ws;

		this.#helloTimer = setTimeout(() => {
			if (this.#probe === ws) {
				this.#teardown(ws);
				this.#advance();
			}
		}, HELLO_TIMEOUT_MS);

		ws.on("message", (data) => {
			if (this.#probe !== ws && this.#socket !== ws) return; // superseded
			let msg: InboundMsg;
			try {
				msg = JSON.parse(data.toString()) as InboundMsg;
			} catch {
				return;
			}
			if (msg.type === "hello") {
				this.#onHello(ws);
			} else if (msg.type === "context") {
				this.emit("context", msg);
			} else if (msg.type === "result") {
				this.#resolveResult(msg);
			}
		});

		ws.on("error", () => {
			/* a 'close' always follows; handle teardown there */
		});

		ws.on("close", () => {
			if (this.#socket === ws) {
				this.#onDisconnected();
			} else if (this.#probe === ws) {
				this.#clearHelloTimer();
				this.#advance();
			}
		});
	}

	#advance(): void {
		this.#probe = null;
		this.#portIndex++;
		this.#openCurrent();
	}

	#onHello(ws: WebSocket): void {
		if (this.#probe !== ws) return; // already promoted or superseded
		this.#clearHelloTimer();
		this.#probe = null;
		this.#socket = ws;
		this.#connected = true;
		this.#opening = false;
		this.#send(ws, { v: 1, type: "ready", device: "streamdeck_mk2", pluginVersion: PLUGIN_VERSION });
		this.emit("connected");
	}

	#onDisconnected(): void {
		this.#connected = false;
		this.#socket = null;
		this.#failPending("Disconnected from SolidWorks");
		this.emit("disconnected");
		this.#scheduleReconnect();
	}

	#scheduleReconnect(): void {
		if (this.#stopped || this.#reconnectTimer) return;
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			this.#beginSweep();
		}, RECONNECT_MS);
	}

	/* ---- Helpers ---- */

	/** Detach listeners and terminate a socket so its late events can't disturb the state machine. */
	#teardown(ws: WebSocket | null): void {
		if (!ws) return;
		ws.removeAllListeners();
		try {
			ws.terminate();
		} catch {
			/* already gone */
		}
	}

	#resolveResult(msg: ResultMsg): void {
		const pending = this.#pending.get(msg.nonce);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.#pending.delete(msg.nonce);
		pending.resolve(msg);
	}

	#failPending(message: string): void {
		for (const [nonce, { resolve, timer }] of this.#pending) {
			clearTimeout(timer);
			resolve({ v: 1, type: "result", nonce, ok: false, message });
		}
		this.#pending.clear();
	}

	#send(ws: WebSocket | null, msg: object): void {
		try {
			if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
		} catch {
			/* socket race during teardown — ignore */
		}
	}

	#clearTimers(): void {
		this.#clearHelloTimer();
		if (this.#reconnectTimer) {
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
	}

	#clearHelloTimer(): void {
		if (this.#helloTimer) {
			clearTimeout(this.#helloTimer);
			this.#helloTimer = null;
		}
	}
}

export const bridge = new AddinBridge();
