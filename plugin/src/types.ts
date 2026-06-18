/** Shared TypeScript types for the Facet wire protocol and command catalog. */

export type DocType = "none" | "part" | "assembly" | "drawing";

export type BindingKind = "home" | "more" | "command" | "new" | "info" | "empty";

/** One key binding within a layout (mirrors shared/catalog.json). */
export interface Binding {
	kind: BindingKind;
	label?: string;
	swCommand?: string;
	commandId?: number | null;
	icon?: string;
	accent?: boolean;
	toggle?: boolean;
	commit?: boolean;
}

export interface Layout {
	title: string;
	extends?: string;
	slots: Binding[];
}

export interface Catalog {
	meta: { version: number; device: string; grid: { cols: number; rows: number; slots: number } };
	layouts: Record<string, Layout>;
}

/** Visual design tokens (mirrors shared/design-tokens.json). */
export interface Tokens {
	color: Record<string, string>;
	stroke: { weight: number; cap: string; join: string };
	type: { family: string; labelSize: number; labelWeight: number; homeTitleSize: number; tracking: number };
	key: { size: number; radius: number; padding: number; iconSize: number };
	motion: { repaintFadeMs: number; okFlashMs: number };
}

/* ---- Wire messages: add-in -> plugin ---- */

export interface HelloMsg {
	v: 1;
	type: "hello";
	app: string;
	appVersion: string;
	port: number;
	protocol: number;
	addinVersion: string;
}

export interface SelectionInfo {
	count: number;
	types: string[];
}

export interface ContextMsg {
	v: 1;
	type: "context";
	docType: DocType;
	inSketch: boolean;
	activeCommand: string | null;
	selection: SelectionInfo;
	docTitle: string;
	layout: string;
}

export interface ResultMsg {
	v: 1;
	type: "result";
	nonce: string;
	ok: boolean;
	message: string | null;
}

export type InboundMsg = HelloMsg | ContextMsg | ResultMsg;

/* ---- Wire messages: plugin -> add-in ---- */

export interface ReadyMsg {
	v: 1;
	type: "ready";
	device: string;
	pluginVersion: string;
}

export interface InvokeMsg {
	v: 1;
	type: "invoke";
	nonce: string;
	command: string | undefined;
	commandId: number | null;
	slot: number;
	layout: string;
}

export type OutboundMsg = ReadyMsg | InvokeMsg;
