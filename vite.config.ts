import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	base: "./",
	root: "src/mainview",
	resolve: {
		alias: {
			"@/components": path.resolve(__dirname, "./src/components"), // Alias @ to the src directory
			"@/lib": path.resolve(__dirname, "./src/lib"), // Alias @ to the src directory
		},
	},
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
	},
});
