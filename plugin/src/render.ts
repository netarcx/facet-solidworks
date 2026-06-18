/**
 * Renders a key to an SVG string for KeyAction.setImage.
 *
 * Phase 0 ships a consistent, tokenized visual language: a dark tile, one accent, one stroke
 * weight, a line glyph where we have one, and a clean label. Bespoke per-command artwork layers
 * in later — the catalog already names an `icon` per binding so art can drop in without code
 * changes.
 */
import { tokens } from "./catalog";
import type { Binding } from "./types";

const SIZE = 144;
const C = tokens.color;

/** Minimal line-glyph library (24×24 viewBox path data). Missing icons fall back gracefully. */
const GLYPHS: Record<string, string> = {
	sketch: "M4 20 L20 4 M14 4 H20 V10",
	extrude: "M5 9 L12 5 L19 9 L12 13 Z M5 9 V16 L12 20 M19 9 V16 L12 20",
	cut: "M6 6 L18 18 M18 6 L6 18",
	revolve: "M12 3 V21 M7 6 A7 9 0 0 0 7 18 M17 6 A7 9 0 0 1 17 18",
	fillet: "M5 19 V9 A4 4 0 0 1 9 5 H19",
	chamfer: "M5 19 V11 L13 5 H19",
	shell: "M5 5 H19 V19 H5 Z M9 9 H15 V15 H9 Z",
	hole: "M12 12 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M12 12 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0",
	plane: "M4 8 L14 8 L20 14 L10 14 Z M14 8 V16 M10 14 V6",
	mirror: "M12 3 V21 M8 7 L4 12 L8 17 M16 7 L20 12 L16 17",
	pattern: "M5 5 h4 v4 h-4 Z M15 5 h4 v4 h-4 Z M5 15 h4 v4 h-4 Z M15 15 h4 v4 h-4 Z",
	measure: "M3 9 H21 V15 H3 Z M7 9 V12 M11 9 V13 M15 9 V12 M19 9 V13",
	line: "M5 19 L19 5",
	rectangle: "M5 7 H19 V17 H5 Z",
	circle: "M12 12 m-8 0 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0",
	arc: "M4 18 A14 14 0 0 1 20 18",
	slot: "M8 8 H16 M8 16 H16 M8 8 A4 4 0 0 0 8 16 M16 8 A4 4 0 0 1 16 16",
	dimension: "M4 8 V16 M20 8 V16 M4 12 H20 M7 9 L4 12 L7 15 M17 9 L20 12 L17 15",
	trim: "M6 18 L18 6 M5 7 a2 2 0 1 0 0.1 0 M5 17 a2 2 0 1 0 0.1 0",
	offset: "M5 7 H15 V17 H5 Z M9 3 H21 V21",
	convert: "M5 12 H15 M15 12 L11 8 M15 12 L11 16 M19 5 V19",
	construction: "M4 18 L20 18 M6 18 L12 8 L18 18",
	relations: "M9 9 a3 3 0 1 0 0.1 0 M15 15 a3 3 0 1 0 0.1 0 M11 11 L13 13",
	"exit-sketch": "M5 12 H16 M12 8 L16 12 L12 16 M19 4 V20",
	mate: "M4 12 H10 M14 12 H20 M10 9 V15 M14 9 V15",
	"insert-component": "M12 4 V20 M4 12 H20",
	move: "M12 3 V21 M3 12 H21 M9 6 L12 3 L15 6 M9 18 L12 21 L15 18 M6 9 L3 12 L6 15 M18 9 L21 12 L18 15",
	rotate: "M20 12 a8 8 0 1 1 -3-6 M20 4 V8 H16",
	explode: "M12 12 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0 M12 7 V3 M12 17 V21 M7 12 H3 M17 12 H21",
	isometric: "M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z M12 3 V12 M12 12 L20 7.5 M12 12 L4 7.5",
	section: "M4 6 H20 V18 H4 Z M4 6 L20 18",
	"model-view": "M5 5 H19 V19 H5 Z M5 12 H19 M12 5 V19",
	"projected-view": "M4 7 h6 v6 h-6 Z M14 11 h6 v6 h-6 Z M10 10 L14 14",
	note: "M5 5 H19 V15 L14 19 H5 Z M14 19 V14 H19",
	balloon: "M12 9 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M12 14 V21",
	print: "M7 9 V4 H17 V9 M7 16 H5 V11 H19 V16 H17 M7 14 H17 V20 H7 Z",
	open: "M4 7 H10 L12 9 H20 V18 H4 Z",
	delete: "M6 7 H18 M9 7 V5 H15 V7 M8 7 L9 19 H15 L16 7",
	"new-part": "M7 3 H15 L19 7 V21 H7 Z M15 3 V7 H19 M10 12 L13 10 L16 12 L13 14 Z M10 12 V15 L13 17 M16 12 V15 L13 17",
	"new-assembly": "M7 3 H15 L19 7 V21 H7 Z M15 3 V7 H19 M9 11 h3 v3 h-3 Z M13 14 h3 v3 h-3 Z",
	"new-drawing": "M7 3 H15 L19 7 V21 H7 Z M15 3 V7 H19 M10 11 H16 V17 H10 Z M10 14 H16",
	hide: "M3 12 C7 6 17 6 21 12 C17 18 7 18 3 12 M12 9 a3 3 0 1 0 0.1 0 M4 4 L20 20",
	"normal-to": "M4 8 L14 8 L20 12 L10 12 Z M12 14 V21 M9 18 L12 21 L15 18",
	interfere: "M10 12 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M14 12 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0",
	isolate: "M12 12 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0 M4 4 h2 M18 4 h2 M4 20 h2 M18 20 h2",
	transparency: "M5 5 H19 V19 H5 Z M5 12 H12 V5 M12 19 V12 H19",
	"section-view": "M5 6 H19 V18 H5 Z M8 18 L11 6 M12 18 L15 6 M16 18 L19 9",
	"detail-view": "M11 11 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M16 16 L21 21",
	"auto-balloon": "M8 8 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M8 11 V15 M16 9 m-3 0 a3 3 0 1 0 6 0 a3 3 0 1 0 -6 0 M16 12 V18",
	"center-mark": "M12 5 V10 M12 14 V19 M5 12 H10 M14 12 H19",
	centerline: "M3 12 H7 M10 12 H11 M14 12 H18 M20 12 H21",
	bom: "M4 5 H20 V19 H4 Z M4 10 H20 M4 15 H20 M12 5 V19",
	"edit-sheet": "M5 4 H13 V20 H5 Z M8 8 H11 M8 12 H11 M14 15 L19 10 L21 12 L16 17 H14 Z",
};

const FALLBACK_GLYPH = "M12 12 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0"; // neutral ring

interface RenderOpts {
	/** Overrides the binding label (e.g. Home shows the live document/context title). */
	label?: string;
	/** Toggle is currently "on" — paints the active accent. */
	active?: boolean;
}

/** Returns a full SVG document string suitable for KeyAction.setImage. */
export function renderKey(b: Binding, opts: RenderOpts = {}): string {
	const label = opts.label ?? b.label ?? "";

	let bg = C.canvasRaised;
	let fg = C.ink;
	let glyphColor = C.inkMuted;

	if (b.kind === "empty") {
		return svg(`<rect width="${SIZE}" height="${SIZE}" fill="${C.canvas}"/>`);
	}
	if (b.commit) {
		bg = C.commit;
		fg = glyphColor = C.accentInk;
	} else if (b.toggle && opts.active) {
		bg = C.toggleOn;
		fg = glyphColor = C.toggleOnInk;
	} else if (b.accent) {
		bg = C.accent;
		fg = glyphColor = C.accentInk;
	} else if (b.kind === "home") {
		fg = C.ink;
		glyphColor = C.accent;
	} else if (b.kind === "info") {
		fg = C.inkMuted;
	}

	const parts: string[] = [];
	parts.push(`<rect x="2" y="2" width="${SIZE - 4}" height="${SIZE - 4}" rx="${tokens.key.radius}" fill="${bg}"/>`);

	if (b.kind === "home") {
		parts.push(homeMark(glyphColor));
		parts.push(textBlock(label, fg, { y: 96, size: tokens.type.homeTitleSize, weight: 700 }));
	} else if (b.kind === "more") {
		parts.push(dots(fg));
		parts.push(textBlock(label || "More", fg, { y: 112, size: 13, weight: 600 }));
	} else if (b.kind === "info") {
		parts.push(textBlock(label, fg, { y: 78, size: 14, weight: 600 }));
	} else {
		const hasLabel = label.length > 0;
		if (b.icon) parts.push(glyph(b.icon, glyphColor, hasLabel ? 30 : 44));
		parts.push(textBlock(label, fg, { y: 118, size: tokens.type.labelSize, weight: tokens.type.labelWeight }));
		if (b.toggle && opts.active) parts.push(`<circle cx="${SIZE - 18}" cy="18" r="5" fill="${C.toggleOnInk}"/>`);
	}

	return svg(parts.join(""));
}

function svg(inner: string): string {
	const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${inner}</svg>`;
	// Stream Deck reliably renders SVG only as a base64 data URI — a raw <svg> string is silently
	// ignored by the app (the key then falls back to the manifest's default image).
	return `data:image/svg+xml;base64,${Buffer.from(doc, "utf8").toString("base64")}`;
}

function glyph(name: string, color: string, top: number): string {
	const d = GLYPHS[name] ?? FALLBACK_GLYPH;
	const scale = tokens.key.iconSize / 24;
	const x = (SIZE - tokens.key.iconSize) / 2;
	return (
		`<g transform="translate(${x} ${top}) scale(${scale})" fill="none" stroke="${color}" ` +
		`stroke-width="${tokens.stroke.weight}" stroke-linecap="${tokens.stroke.cap}" ` +
		`stroke-linejoin="${tokens.stroke.join}"><path d="${d}"/></g>`
	);
}

/** A small faceted-gem mark for the Home key. */
function homeMark(color: string): string {
	return (
		`<g transform="translate(52 28)" fill="none" stroke="${color}" stroke-width="2.5" ` +
		`stroke-linejoin="round"><path d="M20 4 L36 16 L20 36 L4 16 Z M4 16 H36 M20 4 V36 M12 10 L20 16 L28 10"/></g>`
	);
}

function dots(color: string): string {
	const cy = 64;
	return [52, 72, 92].map((cx) => `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${color}"/>`).join("");
}

/** Centered, wrapped, multi-line text anchored at baseline `y`. */
function textBlock(text: string, color: string, o: { y: number; size: number; weight: number }): string {
	const lines = wrap(text);
	const lh = o.size * 1.18;
	const startY = o.y - (lines.length - 1) * lh;
	const tspans = lines
		.map((ln, i) => `<tspan x="${SIZE / 2}" y="${startY + i * lh}">${escapeXml(ln)}</tspan>`)
		.join("");
	return (
		`<text text-anchor="middle" font-family="${escapeXml(tokens.type.family)}" ` +
		`font-size="${o.size}" font-weight="${o.weight}" letter-spacing="${tokens.type.tracking}" ` +
		`fill="${color}">${tspans}</text>`
	);
}

const MAX_CHARS = 10;
const MAX_LINES = 3;

/**
 * Honors explicit newlines, greedily wraps to ~MAX_CHARS/line, HARD-breaks any single word longer
 * than a line (so "Transparency" can't overflow the tile), and ellipsizes if it exceeds 3 lines.
 */
function wrap(text: string): string[] {
	const out: string[] = [];
	for (const segment of text.split("\n")) {
		let line = "";
		for (const word of segment.split(" ")) {
			let w = word;
			// Break an over-long single word across lines.
			while (w.length > MAX_CHARS) {
				if (line) {
					out.push(line);
					line = "";
				}
				out.push(w.slice(0, MAX_CHARS));
				w = w.slice(MAX_CHARS);
			}
			const candidate = line ? `${line} ${w}` : w;
			if (candidate.length > MAX_CHARS && line) {
				out.push(line);
				line = w;
			} else {
				line = candidate;
			}
		}
		if (line) out.push(line);
	}
	if (out.length <= MAX_LINES) return out;
	const kept = out.slice(0, MAX_LINES);
	kept[MAX_LINES - 1] = kept[MAX_LINES - 1].slice(0, MAX_CHARS - 1) + "…";
	return kept;
}

function escapeXml(s: string): string {
	return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}
