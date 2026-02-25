import type { ElectrobunRPCSchema, RPCSchema } from "electrobun/bun";

export type ClipboardItem = {
	id: number;
	type: "text" | "image";
	content: string;
	preview: string;
	source: string;
	timestamp: string;
	hash: string;
};

export type ClipboardRPCSchema = {
	bun: RPCSchema<{
		requests: {
			getItems: {
				params: { query?: string; offset?: number; limit?: number };
				response: { items: ClipboardItem[]; total: number };
			};
			pasteItem: {
				params: { id: number };
				response: { success: boolean };
			};
			deleteItem: {
				params: { id: number };
				response: { success: boolean };
			};
			clearHistory: {
				params: undefined;
				response: { success: boolean };
			};
			hidePanel: {
				params: undefined;
				response: void;
			};
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			clipboardUpdated: { items: ClipboardItem[]; total: number };
			panelVisibilityChanged: { visible: boolean };
		};
	}>;
};
