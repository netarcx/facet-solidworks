/**
 * Controller — the bridge between SolidWorks context and the physical keys.
 *
 * It owns the registry of live key instances (slot 0..14) and the current layout, listens to
 * the add-in bridge, and repaints the deck whenever context changes. The FacetKey action just
 * registers/unregisters keys and forwards presses here.
 */
import streamDeck, { type KeyAction } from "@elgato/streamdeck";
import { bridge } from "./bridge";
import { resolveLayout, SLOTS } from "./catalog";
import { renderKey, titleFor } from "./render";
import type { Binding, ContextMsg, Layout } from "./types";

class Controller {
	#keys = new Map<number, KeyAction>();
	#slotById = new Map<string, number>();
	#layoutKey = "connecting";
	#layout: Layout = resolveLayout("connecting");
	#context: ContextMsg | null = null;
	#contextFallback: NodeJS.Timeout | null = null;

	/** If a context hasn't arrived this long after connect, stop showing "connecting". */
	static readonly FIRST_CONTEXT_TIMEOUT_MS = 4000;

	/** Wire up bridge events. Call once at startup, before bridge.start(). */
	init(): void {
		bridge.on("connected", () => {
			streamDeck.logger.info("Connected to SolidWorks add-in.");
			// The add-in sends a context immediately; if it somehow doesn't, don't hang on
			// "connecting" forever — fall back to the neutral waiting state.
			this.#armContextFallback();
		});
		bridge.on("context", (ctx) => {
			this.#clearContextFallback();
			this.#applyContext(ctx);
		});
		bridge.on("disconnected", () => {
			streamDeck.logger.warn("Lost SolidWorks add-in; showing waiting state.");
			this.#clearContextFallback();
			this.#context = null;
			this.#setLayout("waiting");
		});
	}

	#armContextFallback(): void {
		this.#clearContextFallback();
		this.#contextFallback = setTimeout(() => {
			if (this.#layoutKey === "connecting") this.#setLayout("waiting");
		}, Controller.FIRST_CONTEXT_TIMEOUT_MS);
	}

	#clearContextFallback(): void {
		if (this.#contextFallback) {
			clearTimeout(this.#contextFallback);
			this.#contextFallback = null;
		}
	}

	registerKey(slot: number, action: KeyAction): void {
		if (slot < 0 || slot >= SLOTS) return;
		this.#keys.set(slot, action);
		this.#slotById.set(action.id, slot);
		void this.#paintSlot(slot);
	}

	/** Unregister by action id (WillDisappear doesn't expose coordinates). */
	unregisterById(id: string): void {
		const slot = this.#slotById.get(id);
		if (slot === undefined) return;
		this.#slotById.delete(id);
		if (this.#keys.get(slot)?.id === id) this.#keys.delete(slot);
	}

	bindingAt(slot: number): Binding | undefined {
		return this.#layout.slots[slot];
	}

	get layoutKey(): string {
		return this.#layoutKey;
	}

	/** Handle a key press: run the bound command and give physical feedback. */
	async press(slot: number, action: KeyAction): Promise<void> {
		const b = this.bindingAt(slot);
		if (!b) return;

		if (b.kind === "command" || b.kind === "new") {
			streamDeck.logger.info(`Invoke '${b.swCommand ?? b.commandId}' (slot ${slot}, layout '${this.#layoutKey}')`);
			const result = await bridge.invoke({
				command: b.swCommand,
				commandId: b.commandId ?? null,
				slot,
				layout: this.#layoutKey,
			});
			streamDeck.logger.info(`  → ok=${result.ok}${result.message ? ` (${result.message})` : ""}`);
			if (result.ok) await action.showOk();
			else await action.showAlert();
			return;
		}

		// Home (back) and More (overflow) are navigation affordances — wired up in a later phase.
		streamDeck.logger.info(
			`Key at slot ${slot} is '${b.kind}'${b.label ? ` (${b.label})` : ""} — no command bound here. ` +
				`Command keys are the non-corner positions when a document is open.`,
		);
	}

	#applyContext(ctx: ContextMsg): void {
		this.#context = ctx;
		streamDeck.logger.info(
			`Context → layout='${ctx.layout}' doc='${ctx.docTitle || "(none)"}' ` +
				`inSketch=${ctx.inSketch} sel=${ctx.selection.count} | ${this.#keys.size}/15 keys placed`,
		);
		this.#setLayout(ctx.layout);
	}

	#setLayout(key: string): void {
		this.#layoutKey = key;
		this.#layout = resolveLayout(key);
		void this.#paintAll();
	}

	async #paintAll(): Promise<void> {
		await Promise.all([...this.#keys.keys()].map((slot) => this.#paintSlot(slot)));
	}

	async #paintSlot(slot: number): Promise<void> {
		const action = this.#keys.get(slot);
		const b = this.#layout.slots[slot];
		if (!action || !b) return;
		// The icon is the image; the name is Stream Deck's native title (SVG <text> isn't rendered).
		await action.setImage(renderKey(b));
		await action.setTitle(titleFor(b, this.#homeLabel(b)));
	}

	/** Home key shows the live context — falls back to the layout's name. */
	#homeLabel(b: Binding): string {
		if (this.#context?.docTitle) {
			const name = this.#context.docTitle.replace(/\.[^.]+$/, "");
			return name.length > 12 ? `${name.slice(0, 11)}…` : name;
		}
		return b.label ?? "Facet";
	}
}

export const controller = new Controller();
