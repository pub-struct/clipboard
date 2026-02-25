import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ClipboardItem } from "../shared/rpc-types";

export class ClipboardStore {
	private db: Database;
	private imagesDir: string;

	constructor(userDataPath: string) {
		mkdirSync(userDataPath, { recursive: true });

		this.imagesDir = join(userDataPath, "images");
		mkdirSync(this.imagesDir, { recursive: true });

		this.db = new Database(join(userDataPath, "clipboard.db"));
		this.db.exec("PRAGMA journal_mode=WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS clipboard_items (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				type TEXT NOT NULL CHECK(type IN ('text', 'image')),
				content TEXT NOT NULL,
				preview TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT 'Unknown',
				timestamp TEXT NOT NULL,
				hash TEXT NOT NULL UNIQUE
			)
		`);
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_timestamp ON clipboard_items(timestamp DESC)",
		);
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS idx_hash ON clipboard_items(hash)",
		);
	}

	get imagesPath(): string {
		return this.imagesDir;
	}

	addItem(item: Omit<ClipboardItem, "id">): ClipboardItem | null {
		// On duplicate hash, update timestamp to bring it to the top
		const existing = this.db
			.query<ClipboardItem, [string]>(
				"SELECT * FROM clipboard_items WHERE hash = ?",
			)
			.get(item.hash);

		if (existing) {
			this.db
				.query("UPDATE clipboard_items SET timestamp = ? WHERE hash = ?")
				.run(item.timestamp, item.hash);
			return { ...existing, timestamp: item.timestamp };
		}

		const result = this.db
			.query(
				`INSERT INTO clipboard_items (type, content, preview, source, timestamp, hash)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				item.type,
				item.content,
				item.preview,
				item.source,
				item.timestamp,
				item.hash,
			);

		return {
			id: Number(result.lastInsertRowid),
			...item,
		};
	}

	getItems(
		query?: string,
		offset = 0,
		limit = 50,
	): { items: ClipboardItem[]; total: number } {
		if (query && query.trim()) {
			const pattern = `%${query.trim()}%`;
			const items = this.db
				.query<ClipboardItem, [string, number, number]>(
					`SELECT * FROM clipboard_items
					 WHERE type = 'text' AND content LIKE ?
					 ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
				)
				.all(pattern, limit, offset);
			const total = this.db
				.query<{ count: number }, [string]>(
					`SELECT COUNT(*) as count FROM clipboard_items
					 WHERE type = 'text' AND content LIKE ?`,
				)
				.get(pattern);
			return { items, total: total?.count ?? 0 };
		}

		const items = this.db
			.query<ClipboardItem, [number, number]>(
				"SELECT * FROM clipboard_items ORDER BY timestamp DESC LIMIT ? OFFSET ?",
			)
			.all(limit, offset);
		const total = this.db
			.query<{ count: number }, []>(
				"SELECT COUNT(*) as count FROM clipboard_items",
			)
			.get();
		return { items, total: total?.count ?? 0 };
	}

	getItemById(id: number): ClipboardItem | null {
		return this.db
			.query<ClipboardItem, [number]>(
				"SELECT * FROM clipboard_items WHERE id = ?",
			)
			.get(id);
	}

	deleteItem(id: number): boolean {
		const item = this.getItemById(id);
		if (!item) return false;

		if (item.type === "image" && existsSync(item.content)) {
			try {
				unlinkSync(item.content);
			} catch {
				// ignore file deletion errors
			}
		}

		this.db.query("DELETE FROM clipboard_items WHERE id = ?").run(id);
		return true;
	}

	clearAll(): void {
		// Delete all image files
		try {
			const files = readdirSync(this.imagesDir);
			for (const file of files) {
				try {
					unlinkSync(join(this.imagesDir, file));
				} catch {
					// ignore
				}
			}
		} catch {
			// ignore
		}

		this.db.exec("DELETE FROM clipboard_items");
	}

	pruneOldItems(maxItems = 500): void {
		const count = this.db
			.query<{ count: number }, []>(
				"SELECT COUNT(*) as count FROM clipboard_items",
			)
			.get();

		if (!count || count.count <= maxItems) return;

		// Get items to delete (oldest beyond maxItems)
		const toDelete = this.db
			.query<ClipboardItem, [number]>(
				`SELECT * FROM clipboard_items
				 ORDER BY timestamp DESC
				 LIMIT -1 OFFSET ?`,
			)
			.all(maxItems);

		for (const item of toDelete) {
			if (item.type === "image" && existsSync(item.content)) {
				try {
					unlinkSync(item.content);
				} catch {
					// ignore
				}
			}
		}

		this.db.exec(
			`DELETE FROM clipboard_items WHERE id NOT IN (
				SELECT id FROM clipboard_items ORDER BY timestamp DESC LIMIT ${maxItems}
			)`,
		);
	}
}
