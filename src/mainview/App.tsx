import { Electroview } from "electrobun/view";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardItem, ClipboardRPCSchema } from "../shared/rpc-types";

// --- RPC setup ---
let rpcProxy:
	| ReturnType<typeof Electroview.defineRPC<ClipboardRPCSchema>>["proxy"]
	| null = null;
let onClipboardUpdated:
	| ((data: { items: ClipboardItem[]; total: number }) => void)
	| null = null;
let onPanelVisibilityChanged: ((data: { visible: boolean }) => void) | null =
	null;

try {
	const rpc = Electroview.defineRPC<ClipboardRPCSchema>({
		handlers: {
			requests: {},
			messages: {
				clipboardUpdated: (data) => {
					onClipboardUpdated?.(data);
				},
				panelVisibilityChanged: (data) => {
					onPanelVisibilityChanged?.(data);
				},
			},
		},
	});

	const electroview = new Electroview({ rpc });
	rpcProxy = rpc.proxy;
} catch {
	// RPC not available (running in browser dev mode)
	console.warn("Electroview RPC not available - running in dev mode");
}

// --- Helpers ---
function timeAgo(isoString: string): string {
	const now = Date.now();
	const then = new Date(isoString).getTime();
	const seconds = Math.floor((now - then) / 1000);

	if (seconds < 10) return "just now";
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function truncate(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen) + "...";
}

// --- Component ---
function App() {
	const [items, setItems] = useState<ClipboardItem[]>([]);
	const [total, setTotal] = useState(0);
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(false);
	const searchRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const fetchItems = useCallback(async (searchQuery?: string) => {
		if (!rpcProxy) return;
		setLoading(true);
		try {
			const result = await rpcProxy.request.getItems({
				query: searchQuery,
				offset: 0,
				limit: 50,
			});
			setItems(result.items);
			setTotal(result.total);
		} catch (err) {
			console.error("Failed to fetch items:", err);
		} finally {
			setLoading(false);
		}
	}, []);

	// Register message handlers
	useEffect(() => {
		onClipboardUpdated = (data) => {
			setItems(data.items);
			setTotal(data.total);
		};
		onPanelVisibilityChanged = (data) => {
			if (data.visible) {
				setQuery("");
				setTimeout(() => searchRef.current?.focus(), 50);
			}
		};
		return () => {
			onClipboardUpdated = null;
			onPanelVisibilityChanged = null;
		};
	}, []);

	// Initial load
	useEffect(() => {
		fetchItems();
	}, [fetchItems]);

	// Debounced search
	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			fetchItems(query || undefined);
		}, 300);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [query, fetchItems]);

	// Blur + Escape handlers (small delay on blur to avoid race with click-to-paste)
	useEffect(() => {
		let blurTimeout: ReturnType<typeof setTimeout> | null = null;
		const handleBlur = () => {
			blurTimeout = setTimeout(() => {
				rpcProxy?.request.hidePanel();
			}, 100);
		};
		const handleFocus = () => {
			if (blurTimeout) {
				clearTimeout(blurTimeout);
				blurTimeout = null;
			}
		};
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				rpcProxy?.request.hidePanel();
			}
		};
		window.addEventListener("blur", handleBlur);
		window.addEventListener("focus", handleFocus);
		window.addEventListener("keydown", handleKeyDown);
		return () => {
			if (blurTimeout) clearTimeout(blurTimeout);
			window.removeEventListener("blur-sm", handleBlur);
			window.removeEventListener("focus", handleFocus);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, []);

	const handlePaste = async (id: number) => {
		if (!rpcProxy) return;
		await rpcProxy.request.pasteItem({ id });
	};

	const handleDelete = async (e: React.MouseEvent, id: number) => {
		e.stopPropagation();
		if (!rpcProxy) return;
		await rpcProxy.request.deleteItem({ id });
		setItems((prev) => prev.filter((item) => item.id !== id));
		setTotal((prev) => prev - 1);
	};

	return (
		<div className="w-full h-screen p-2">
			<div className="w-full h-full bg-gray-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-700/50 flex flex-col overflow-hidden">
				{/* Header / Search */}
				<div className="p-4 border-b border-gray-700/50">
					<div className="relative">
						<svg
							className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
							/>
						</svg>
						<input
							ref={searchRef}
							type="text"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search clipboard history..."
							className="w-full pl-10 pr-4 py-2.5 bg-gray-800/80 border border-gray-600/50 rounded-xl text-gray-200 placeholder-gray-500 text-sm focus:outline-hidden focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
						/>
						{query && (
							<button
								onClick={() => setQuery("")}
								className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
							>
								<svg
									className="w-4 h-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						)}
					</div>
					<div className="mt-2 text-xs text-gray-500">
						{total} item{total !== 1 ? "s" : ""} in history
						{query && " (filtered)"}
					</div>
				</div>

				{/* Items list */}
				<div className="flex-1 overflow-y-auto custom-scrollbar">
					{items.length === 0 ? (
						<div className="flex items-center justify-center h-full text-gray-500 text-sm">
							{loading
								? "Loading..."
								: query
									? "No matching items"
									: "Clipboard history is empty"}
						</div>
					) : (
						<div className="p-1">
							{items.map((item) => (
								<button
									key={item.id}
									onClick={() => handlePaste(item.id)}
									className="w-full text-left p-3 mx-1 my-0.5 rounded-xl hover:bg-gray-800/80 transition-colors group cursor-pointer"
								>
									<div className="flex items-start gap-3">
										{/* Type icon */}
										<div className="shrink-0 mt-0.5">
											{item.type === "text" ? (
												<div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
													<svg
														className="w-4 h-4 text-blue-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															strokeLinecap="round"
															strokeLinejoin="round"
															strokeWidth={2}
															d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
														/>
													</svg>
												</div>
											) : (
												<div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
													<svg
														className="w-4 h-4 text-purple-400"
														fill="none"
														stroke="currentColor"
														viewBox="0 0 24 24"
													>
														<path
															strokeLinecap="round"
															strokeLinejoin="round"
															strokeWidth={2}
															d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
														/>
													</svg>
												</div>
											)}
										</div>

										{/* Content */}
										<div className="flex-1 min-w-0">
											<p className="text-sm text-gray-200 whitespace-pre-wrap wrap-break-word line-clamp-3">
												{item.type === "text"
													? truncate(item.preview, 200)
													: `[Image] ${item.preview}`}
											</p>
											<div className="flex items-center gap-2 mt-1.5">
												<span className="text-xs text-gray-500 truncate max-w-[200px]">
													{item.source}
												</span>
												<span className="text-xs text-gray-600">
													{timeAgo(item.timestamp)}
												</span>
											</div>
										</div>

										{/* Delete button */}
										<button
											onClick={(e) => handleDelete(e, item.id)}
											className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400"
										>
											<svg
												className="w-4 h-4"
												fill="none"
												stroke="currentColor"
												viewBox="0 0 24 24"
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													strokeWidth={2}
													d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
												/>
											</svg>
										</button>
									</div>
								</button>
							))}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="px-4 py-2 border-t border-gray-700/50 flex items-center justify-between text-xs text-gray-500">
					<span>Super+Shift+V to toggle</span>
					<span>Click to paste | Esc to close</span>
				</div>
			</div>
		</div>
	);
}

export default App;
