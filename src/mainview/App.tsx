import { Electroview } from "electrobun/view";
import {
	ClipboardIcon,
	FileTextIcon,
	ImageIcon,
	SearchIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
	Tooltip,
	TooltipPopup,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
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
	return `${text.slice(0, maxLen)}...`;
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

	// Blur + Escape handlers
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
			window.removeEventListener("blur", handleBlur);
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
		<TooltipProvider>
			<div className="dark w-full h-screen p-2">
				<div className="w-full h-full bg-background/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden">
					{/* Search header */}
					<div className="p-3 pb-0">
						<InputGroup>
							<InputGroupAddon align="inline-start">
								<SearchIcon />
							</InputGroupAddon>
							<InputGroupInput
								ref={searchRef}
								type="search"
								value={query}
								onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
									setQuery(e.target.value)
								}
								placeholder="Search clipboard history..."
							/>
							{query && (
								<InputGroupAddon align="inline-end">
									<Tooltip>
										<TooltipTrigger
											render={
												<Button
													variant="ghost"
													size="icon-xs"
													onClick={() => setQuery("")}
													className="text-muted-foreground"
												/>
											}
										>
											<XIcon className="size-3.5" />
										</TooltipTrigger>
										<TooltipPopup>Clear search</TooltipPopup>
									</Tooltip>
								</InputGroupAddon>
							)}
						</InputGroup>
						<div className="flex items-center justify-between mt-2 px-1 pb-2">
							<span className="text-xs text-muted-foreground">
								{total} item{total !== 1 ? "s" : ""} in history
								{query && " (filtered)"}
							</span>
						</div>
					</div>

					<Separator />

					{/* Items list */}
					<div className="flex-1 min-h-0">
						{items.length === 0 ? (
							<Empty className="h-full">
								<EmptyMedia variant="icon">
									<ClipboardIcon className="size-4.5" />
								</EmptyMedia>
								<EmptyHeader>
									<EmptyTitle className="text-base">
										{loading
											? "Loading..."
											: query
												? "No matches"
												: "Nothing here yet"}
									</EmptyTitle>
									<EmptyDescription>
										{loading
											? "Fetching your clipboard history"
											: query
												? "Try a different search term"
												: "Copy something to get started"}
									</EmptyDescription>
								</EmptyHeader>
							</Empty>
						) : (
							<ScrollArea scrollFade>
								<div className="p-1.5">
									{items.map((item) => (
										<button
											type="button"
											key={item.id}
											onClick={() => handlePaste(item.id)}
											className="w-full text-left p-2.5 rounded-lg hover:bg-accent/50 transition-colors group cursor-pointer flex items-start gap-3"
										>
											{/* Type icon */}
											<div className="shrink-0 mt-0.5">
												{item.type === "text" ? (
													<div className="size-8 rounded-md border bg-card flex items-center justify-center shadow-sm">
														<FileTextIcon className="size-4 text-info-foreground" />
													</div>
												) : (
													<div className="size-8 rounded-md border bg-card flex items-center justify-center shadow-sm">
														<ImageIcon className="size-4 text-warning-foreground" />
													</div>
												)}
											</div>

											{/* Content */}
											<div className="flex-1 min-w-0">
												<p className="text-sm text-foreground whitespace-pre-wrap break-words line-clamp-3">
													{item.type === "text"
														? truncate(item.preview, 200)
														: `[Image] ${item.preview}`}
												</p>
												<div className="flex items-center gap-2 mt-1.5">
													<Badge variant="outline" size="sm">
														{item.source}
													</Badge>
													<span className="text-xs text-muted-foreground">
														{timeAgo(item.timestamp)}
													</span>
												</div>
											</div>

											{/* Delete button */}
											<Tooltip>
												<TooltipTrigger
													render={
														<Button
															variant="ghost"
															size="icon-xs"
															onClick={(
																e: React.MouseEvent<HTMLButtonElement>,
															) => handleDelete(e, item.id)}
															className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive-foreground"
														/>
													}
												>
													<Trash2Icon className="size-3.5" />
												</TooltipTrigger>
												<TooltipPopup>Delete</TooltipPopup>
											</Tooltip>
										</button>
									))}
								</div>
							</ScrollArea>
						)}
					</div>

					<Separator />

					{/* Footer */}
					<div className="px-3 py-2 flex items-center justify-between text-xs text-muted-foreground">
						<span className="flex items-center gap-1.5">
							<KbdGroup>
								<Kbd>Super</Kbd>
								<Kbd>Shift</Kbd>
								<Kbd>V</Kbd>
							</KbdGroup>
							<span>toggle</span>
						</span>
						<span className="flex items-center gap-3">
							<span className="flex items-center gap-1.5">Click to paste</span>
							<span className="flex items-center gap-1.5">
								<Kbd>Esc</Kbd>
								<span>close</span>
							</span>
						</span>
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}

export default App;
