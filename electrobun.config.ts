import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "clipboard-manager",
		identifier: "clipboard.pubstruct.dev",
		version: "0.0.1",
	},
	build: {
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		watchIgnore: ["dist/**"],
		mac: { bundleCEF: false },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	},
	runtime: {
		exitOnLastWindowClosed: false,
	},
} satisfies ElectrobunConfig;
