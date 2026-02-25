import { dlopen, FFIType, type Pointer } from "bun:ffi";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BrowserView,
	BrowserWindow,
	Screen,
	Tray,
	Updater,
	Utils,
} from "electrobun/bun";
import type { ClipboardRPCSchema } from "../shared/rpc-types";
import { ClipboardStore } from "./clipboard-store";
import { ClipboardWatcher } from "./clipboard-watcher";

const TOGGLE_PORT = 17394;
const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const PANEL_WIDTH = 600;
const PANEL_HEIGHT = 500;

// =============================================================================
// Direct GTK FFI — Electrobun has no hide()/show() so we call GTK ourselves
// =============================================================================
const gtk = dlopen("libgtk-3.so.0", {
	gtk_widget_hide: { args: [FFIType.ptr], returns: FFIType.void },
	gtk_widget_show_all: { args: [FFIType.ptr], returns: FFIType.void },
	gtk_window_set_skip_taskbar_hint: {
		args: [FFIType.ptr, FFIType.bool],
		returns: FFIType.void,
	},
	gtk_window_set_skip_pager_hint: {
		args: [FFIType.ptr, FFIType.bool],
		returns: FFIType.void,
	},
	gtk_window_present: { args: [FFIType.ptr], returns: FFIType.void },
	gtk_window_set_type_hint: {
		args: [FFIType.ptr, FFIType.i32],
		returns: FFIType.void,
	},
});

function gtkHideWindow(windowPtr: Pointer): void {
	gtk.symbols.gtk_widget_hide(windowPtr);
}

function gtkShowWindow(windowPtr: Pointer): void {
	gtk.symbols.gtk_widget_show_all(windowPtr);
	gtk.symbols.gtk_window_present(windowPtr);
}

function gtkSkipTaskbar(windowPtr: Pointer, skip: boolean): void {
	gtk.symbols.gtk_window_set_skip_taskbar_hint(windowPtr, skip);
	gtk.symbols.gtk_window_set_skip_pager_hint(windowPtr, skip);
}

// GdkWindowTypeHint enum values
const GDK_WINDOW_TYPE_HINT_DIALOG = 1;

function gtkSetDialogHint(windowPtr: Pointer): void {
	// Setting the window as a DIALOG tells Mutter (GNOME's compositor) that
	// this is a transient window. When a dialog hides, the compositor
	// automatically returns focus to the previously focused window.
	gtk.symbols.gtk_window_set_type_hint(windowPtr, GDK_WINDOW_TYPE_HINT_DIALOG);
}

// =============================================================================
// Singleton check: if daemon is already running, send toggle and exit
// =============================================================================
try {
	const res = await fetch(`http://127.0.0.1:${TOGGLE_PORT}/toggle`, {
		signal: AbortSignal.timeout(300),
	});
	if (res.ok) {
		console.log("Daemon already running, toggled panel.");
		process.exit(0);
	}
} catch {
	// No daemon running, we are the first instance — continue
}

// =============================================================================
// We are the daemon — set up everything
// =============================================================================

// --- URL resolution ---
async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return "views://mainview/index.html";
}

// --- Initialize storage ---
const store = new ClipboardStore(Utils.paths.userData);

// --- Panel state ---
let panelVisible = false;

function getCenterPosition(): { x: number; y: number } {
	const display = Screen.getPrimaryDisplay();
	return {
		x: Math.round(
			display.workArea.x + (display.workArea.width - PANEL_WIDTH) / 2,
		),
		y: Math.round(
			display.workArea.y + (display.workArea.height - PANEL_HEIGHT) / 2,
		),
	};
}

// --- Define RPC ---
const rpc = BrowserView.defineRPC<ClipboardRPCSchema>({
	maxRequestTime: 5000,
	handlers: {
		requests: {
			getItems: (params) => {
				return store.getItems(
					params?.query,
					params?.offset,
					params?.limit ?? 50,
				);
			},
			pasteItem: (params) => {
				const item = store.getItemById(params.id);
				if (!item) return { success: false };

				watcher.setIgnoreNext();
				if (item.type === "text") {
					Utils.clipboardWriteText(item.content);
				} else {
					try {
						const imageData = readFileSync(item.content);
						Utils.clipboardWriteImage(new Uint8Array(imageData));
					} catch {
						return { success: false };
					}
				}
				hidePanel();
				return { success: true };
			},
			deleteItem: (params) => {
				return { success: store.deleteItem(params.id) };
			},
			clearHistory: () => {
				store.clearAll();
				return { success: true };
			},
			hidePanel: () => {
				hidePanel();
			},
		},
		messages: {},
	},
});

// --- Create panel window ---
const url = await getMainViewUrl();
const center = getCenterPosition();

const panelWindow = new BrowserWindow({
	title: "Clipboard Manager",
	url,
	frame: {
		x: center.x,
		y: center.y,
		width: PANEL_WIDTH,
		height: PANEL_HEIGHT,
	},
	titleBarStyle: "hidden",
	transparent: true,
	rpc,
});

// Immediately configure and hide:
// - Dialog hint → Mutter returns focus to previous window on hide
// - Skip taskbar → doesn't appear in alt-tab
// - Hide → invisible until toggled
queueMicrotask(() => {
	gtkSetDialogHint(panelWindow.ptr);
	gtkSkipTaskbar(panelWindow.ptr, true);
	gtkHideWindow(panelWindow.ptr);
});

// --- Show/Hide panel ---
function showPanel(): void {
	const pos = getCenterPosition();
	panelWindow.setFrame(pos.x, pos.y, PANEL_WIDTH, PANEL_HEIGHT);
	panelWindow.setAlwaysOnTop(true);
	gtkShowWindow(panelWindow.ptr);
	panelVisible = true;

	// Push fresh items to webview
	try {
		const data = store.getItems(undefined, 0, 50);
		panelWindow.webview.rpc.proxy.send.panelVisibilityChanged({
			visible: true,
		});
		panelWindow.webview.rpc.proxy.send.clipboardUpdated(data);
	} catch {
		// RPC may not be ready yet
	}
}

function hidePanel(): void {
	if (!panelVisible) return;
	panelVisible = false;
	panelWindow.setAlwaysOnTop(false);
	// Hiding a DIALOG-type window tells Mutter to refocus the previous window
	gtkHideWindow(panelWindow.ptr);

	try {
		panelWindow.webview.rpc.proxy.send.panelVisibilityChanged({
			visible: false,
		});
	} catch {
		// RPC may not be ready yet
	}
}

function togglePanel(): void {
	if (panelVisible) {
		hidePanel();
	} else {
		showPanel();
	}
}

// =============================================================================
// Toggle server: listens for external toggle commands (from system keybind)
// =============================================================================
Bun.serve({
	port: TOGGLE_PORT,
	hostname: "127.0.0.1",
	fetch(req) {
		const path = new URL(req.url).pathname;
		if (path === "/toggle") {
			togglePanel();
			return new Response("toggled");
		}
		if (path === "/show") {
			if (!panelVisible) showPanel();
			return new Response("shown");
		}
		if (path === "/hide") {
			if (panelVisible) hidePanel();
			return new Response("hidden");
		}
		if (path === "/quit") {
			Utils.quit();
			return new Response("quitting");
		}
		return new Response("not found", { status: 404 });
	},
});

console.log(`Toggle server listening on http://127.0.0.1:${TOGGLE_PORT}`);

// --- System tray ---
const tray = new Tray({ title: "CB" });
tray.setMenu([
	{ type: "normal", label: "Show Clipboard", action: "show" },
	{ type: "separator" },
	{ type: "normal", label: "Clear History", action: "clear" },
	{ type: "separator" },
	{ type: "normal", label: "Quit", action: "quit" },
]);

tray.on("action", (actionId: string) => {
	if (actionId === "show") {
		togglePanel();
	} else if (actionId === "clear") {
		store.clearAll();
		if (panelVisible) {
			try {
				panelWindow.webview.rpc.proxy.send.clipboardUpdated({
					items: [],
					total: 0,
				});
			} catch {
				// ignore
			}
		}
	} else if (actionId === "quit") {
		Utils.quit();
	}
});

// --- Clipboard watcher ---
const watcher = new ClipboardWatcher((data) => {
	const hash =
		data.type === "text"
			? Bun.hash(data.textContent!).toString(16)
			: `${Bun.hash(data.imageData!.slice(0, 4096)).toString(16)}_${data.imageData!.length}`;

	let content: string;
	let preview: string;

	if (data.type === "text") {
		content = data.textContent!;
		preview = content.slice(0, 200);
	} else {
		const filename = `${Date.now()}_${hash}.png`;
		const filepath = join(store.imagesPath, filename);
		Bun.write(filepath, data.imageData!);
		content = filepath;
		preview = filename;
	}

	store.addItem({
		type: data.type,
		content,
		preview,
		source: data.source,
		timestamp: new Date().toISOString(),
		hash,
	});

	store.pruneOldItems(500);

	// Push update to webview if panel is visible
	if (panelVisible) {
		try {
			const items = store.getItems(undefined, 0, 50);
			panelWindow.webview.rpc.proxy.send.clipboardUpdated(items);
		} catch {
			// ignore
		}
	}
}, 500);

watcher.start();

console.log("Clipboard Manager daemon started!");
console.log("Set up your system keybind to run:");
console.log(`  curl -s http://127.0.0.1:${TOGGLE_PORT}/toggle`);
