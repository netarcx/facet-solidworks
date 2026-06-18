/** Loads the shared catalog + design tokens (bundled at build time) and resolves layouts. */
import catalogJson from "../../shared/catalog.json";
import tokensJson from "../../shared/design-tokens.json";
import type { Binding, Catalog, Layout, Tokens } from "./types";

export const catalog = catalogJson as unknown as Catalog;
export const tokens = tokensJson as unknown as Tokens;

export const SLOTS = catalog.meta.grid.slots; // 15 for the MK.2
export const COLS = catalog.meta.grid.cols; // 5

const EMPTY: Binding = { kind: "empty" };

/** Synthetic layouts shown when SolidWorks isn't connected — not user commands. */
const SYNTHETIC: Record<string, Layout> = {
	connecting: row0("Facet", { kind: "info", label: "Looking for\nSolidWorks…" }),
	waiting: row0("Facet", { kind: "info", label: "Start SolidWorks\nto begin" }),
};

function row0(homeLabel: string, center: Binding): Layout {
	const slots = Array.from({ length: SLOTS }, () => ({ ...EMPTY }));
	slots[0] = { kind: "home", label: homeLabel };
	slots[7] = center; // visually central key on a 5×3 grid
	return { title: homeLabel, slots };
}

/**
 * Returns a layout by key with `extends` resolved (child slots override parent slots),
 * falling back to synthetic layouts and finally an all-empty grid.
 */
export function resolveLayout(key: string): Layout {
	if (SYNTHETIC[key]) return SYNTHETIC[key];

	const layout = catalog.layouts[key];
	if (!layout) return SYNTHETIC.waiting;
	if (!layout.extends) return normalize(layout);

	const parent = resolveLayout(layout.extends);
	const slots = parent.slots.map((p, i) => layout.slots[i] ?? p);
	return { title: layout.title, slots };
}

/** Guarantees exactly SLOTS entries so the renderer can index safely. */
function normalize(layout: Layout): Layout {
	const slots = Array.from({ length: SLOTS }, (_, i) => layout.slots[i] ?? { ...EMPTY });
	return { title: layout.title, slots };
}
