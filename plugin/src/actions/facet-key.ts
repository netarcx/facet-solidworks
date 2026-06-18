/**
 * FacetKey — the single action type that fills all 15 keys of the MK.2.
 *
 * Every key on the deck is an instance of this action. The action is deliberately "dumb": it
 * reports its grid position to the Controller, which decides what the key currently means based
 * on SolidWorks context. This is what lets one profile become Part tools, Sketch tools, etc.
 */
import { action, type DialAction, type KeyAction, type KeyDownEvent, SingletonAction, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import { COLS } from "../catalog";
import { controller } from "../controller";

@action({ UUID: "com.swrobotics.facet.key" })
export class FacetKey extends SingletonAction {
	override onWillAppear(ev: WillAppearEvent): void {
		const slot = slotOf(ev.action);
		if (slot !== undefined) controller.registerKey(slot, ev.action as KeyAction);
	}

	override onWillDisappear(ev: WillDisappearEvent): void {
		controller.unregisterById(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		const slot = slotOf(ev.action);
		if (slot !== undefined) await controller.press(slot, ev.action as KeyAction);
	}
}

/** Resolve a key's slot index (row-major) from its coordinates; undefined when off-grid. */
function slotOf(a: KeyAction | DialAction): number | undefined {
	if (!a.isKey()) return undefined;
	const c = a.coordinates;
	if (!c) return undefined;
	return c.row * COLS + c.column;
}
