import { Utils } from "electrobun/bun";

export type ClipboardChangeData = {
	type: "text" | "image";
	textContent?: string;
	imageData?: Uint8Array;
	source: string;
};

type ClipboardChangeHandler = (data: ClipboardChangeData) => void;

export class ClipboardWatcher {
	private intervalId: ReturnType<typeof setInterval> | null = null;
	private lastTextHash = "";
	private lastImageHash = "";
	private onChange: ClipboardChangeHandler;
	private pollInterval: number;
	private skipNext = false;

	constructor(onChange: ClipboardChangeHandler, pollInterval = 500) {
		this.onChange = onChange;
		this.pollInterval = pollInterval;
	}

	start(): void {
		if (this.intervalId) return;

		// Capture initial clipboard state so we don't fire on startup
		this.captureCurrentState();

		this.intervalId = setInterval(() => this.poll(), this.pollInterval);
		console.log(
			`Clipboard watcher started (polling every ${this.pollInterval}ms)`,
		);
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
			console.log("Clipboard watcher stopped");
		}
	}

	setIgnoreNext(): void {
		this.skipNext = true;
	}

	private captureCurrentState(): void {
		try {
			const formats = Utils.clipboardAvailableFormats();
			if (formats.includes("text")) {
				const text = Utils.clipboardReadText();
				if (text) {
					this.lastTextHash = this.hashText(text);
				}
			}
			if (formats.includes("image")) {
				const image = Utils.clipboardReadImage();
				if (image) {
					this.lastImageHash = this.hashImage(image);
				}
			}
		} catch {
			// ignore errors during initial capture
		}
	}

	private async poll(): Promise<void> {
		if (this.skipNext) {
			this.skipNext = false;
			// Re-capture state after our own write
			this.captureCurrentState();
			return;
		}

		try {
			const formats = Utils.clipboardAvailableFormats();

			// Check for text changes
			if (formats.includes("text")) {
				const text = Utils.clipboardReadText();
				if (text && text.trim().length > 0) {
					const hash = this.hashText(text);
					if (hash !== this.lastTextHash) {
						this.lastTextHash = hash;
						const source = await this.getActiveWindowName();
						this.onChange({ type: "text", textContent: text, source });
						return; // Don't check image if text changed
					}
				}
			}

			// Check for image changes
			if (formats.includes("image")) {
				const image = Utils.clipboardReadImage();
				if (image && image.length > 0) {
					const hash = this.hashImage(image);
					if (hash !== this.lastImageHash) {
						this.lastImageHash = hash;
						const source = await this.getActiveWindowName();
						this.onChange({ type: "image", imageData: image, source });
					}
				}
			}
		} catch (err) {
			// Silently ignore clipboard read errors
		}
	}

	private async getActiveWindowName(): Promise<string> {
		try {
			// Use GNOME Shell Introspect D-Bus (works on GNOME 46+ Wayland)
			const proc = Bun.spawn(
				[
					"gdbus",
					"call",
					"--session",
					"--dest",
					"org.gnome.Shell",
					"--object-path",
					"/org/gnome/Shell/Introspect",
					"--method",
					"org.gnome.Shell.Introspect.GetWindows",
				],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const output = await new Response(proc.stdout).text();
			const exitCode = await proc.exited;
			if (exitCode === 0) {
				// Find the window with 'focus': <true> and extract its 'wm-class-instance'
				// The output is a GVariant dict — we parse it with regex
				const focusMatch = output.match(
					/'wm-class':\s*<'([^']+)'>[^}]*'has-focus':\s*<true>/,
				);
				if (focusMatch?.[1]) {
					return focusMatch[1];
				}
				// Try alternate key ordering
				const altMatch = output.match(
					/'has-focus':\s*<true>[^}]*'wm-class':\s*<'([^']+)'>/,
				);
				if (altMatch?.[1]) {
					return altMatch[1];
				}
			}
		} catch {
			// gdbus not available or failed
		}
		return "Unknown";
	}

	private hashText(text: string): string {
		return Bun.hash(text).toString(16);
	}

	private hashImage(data: Uint8Array): string {
		// Hash first 4KB + length for speed
		const slice = data.slice(0, 4096);
		return `${Bun.hash(slice).toString(16)}_${data.length}`;
	}
}
