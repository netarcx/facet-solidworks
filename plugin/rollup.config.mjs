import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";

const sdPlugin = "com.swrobotics.facet.sdPlugin";

/** @type {import("rollup").RollupOptions} */
export default {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		format: "cjs",
		sourcemap: true,
		sourcemapPathTransform: (rel) => rel.replace(/^\.\.[\\/]/, `../../src/`),
	},
	plugins: [
		json(),
		typescript({ tsconfig: "./tsconfig.json", compilerOptions: { noEmit: false } }),
		nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
		commonjs(),
	],
	external: [],
};
