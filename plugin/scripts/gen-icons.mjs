// Rasterizes the source SVG icons to the PNGs the Stream Deck manifest requires (@1x + @2x).
// Run with: npm run icons   (from plugin/). SVGs remain the source of truth.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const imgs = join(dirname(fileURLToPath(import.meta.url)), "..", "com.swrobotics.facet.sdPlugin", "imgs");

// [source svg, output png (extensionless base), nominal width]
const ICONS = [
	["plugin/marketplace.svg", "plugin/marketplace", 256],
	["plugin/category.svg", "plugin/category", 28],
	["actions/key/icon.svg", "actions/key/icon", 20],
	["actions/key/key.svg", "actions/key/key", 72],
];

function render(svgPath, outPath, width) {
	const svg = readFileSync(svgPath, "utf8");
	const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
	writeFileSync(outPath, png);
}

for (const [src, base, w] of ICONS) {
	const svgPath = join(imgs, src);
	render(svgPath, join(imgs, `${base}.png`), w);
	render(svgPath, join(imgs, `${base}@2x.png`), w * 2);
	console.log(`✓ ${base}.png (${w}px) + @2x (${w * 2}px)`);
}
console.log("Icons generated.");
