import { promises as fsp } from 'fs';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Bot } from 'mineflayer';

export interface StoredPosition {
  x: number;
  y: number;
  z: number;
}

export interface ChestRecord {
  id: string;
  label: string;
  notes?: string;
  hidden?: boolean;
  forbidden?: boolean; // If true, chest is invisible to the bot and access is denied
  type: 'single_chest' | 'double_chest' | 'trapped_chest' | 'barrel' | 'ender_chest' | 'shulker_box' | 'container';
  positions: StoredPosition[]; // For double chests, two positions; otherwise single
  primary: StoredPosition; // Canonical position to represent chest
  dimension: string;
  createdAt: string;
  updatedAt: string;
  destroyed?: boolean;
}

interface WorldStore {
  chests: ChestRecord[];
}

interface RootStore {
  version: number;
  worlds: Record<string, WorldStore>;
}

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirnameLocal, '..', '..', 'data');
const dataPath = join(dataDir, 'chests.json');

let store: RootStore = {
  version: 1,
  worlds: {}
};

let loaded = false;
let savePending: NodeJS.Timeout | null = null;

function scheduleSave() {
  if (savePending) clearTimeout(savePending);
  savePending = setTimeout(async () => {
    try {
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      await fsp.writeFile(dataPath, JSON.stringify(store, null, 2), 'utf8');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[ChestStore] Failed to save store:', err);
    }
  }, 100);
}

export async function loadStore(): Promise<void> {
  if (loaded) return;
  try {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    if (existsSync(dataPath)) {
      const content = await fsp.readFile(dataPath, 'utf8');
      const parsed = JSON.parse(content);
      // Basic validation
      if (parsed && typeof parsed === 'object' && parsed.worlds) {
        store = parsed;
      }
    } else {
      await fsp.writeFile(dataPath, JSON.stringify(store, null, 2), 'utf8');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ChestStore] Failed to load store:', err);
  } finally {
    loaded = true;
  }
}

export async function saveStore(): Promise<void> {
  scheduleSave();
}

function normalizeLabel(label: string): string {
  return label.trim();
}

function posEquals(a: StoredPosition, b: StoredPosition): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function getWorldKey(bot: Bot): string {
  const host = (bot as any).serverHost || (bot as any)?._client?.options?.host || 'localhost';
  const port = (bot as any).serverPort || (bot as any)?._client?.options?.port || 25565;
  const dimension = bot.game?.dimension || 'overworld';
  return `${host}:${port}:${dimension}`;
}

function ensureWorld(worldKey: string): WorldStore {
  if (!store.worlds[worldKey]) {
    store.worlds[worldKey] = { chests: [] };
  }
  return store.worlds[worldKey];
}

export function listChests(worldKey: string, includeHidden = false): ChestRecord[] {
  const ws = ensureWorld(worldKey);
  return ws.chests.filter(c => !c.destroyed && (includeHidden || !c.hidden) && !c.forbidden);
}

export function getChestByLabel(worldKey: string, label: string): ChestRecord | undefined {
  const ws = ensureWorld(worldKey);
  const norm = normalizeLabel(label).toLowerCase();
  return ws.chests.find(c => !c.destroyed && !c.forbidden && c.label.toLowerCase() === norm);
}

export function getChestByPosition(worldKey: string, pos: StoredPosition): ChestRecord | undefined {
  const ws = ensureWorld(worldKey);
  return ws.chests.find(c => !c.destroyed && c.positions.some(p => posEquals(p, pos)));
}

export function upsertChest(worldKey: string, record: ChestRecord): ChestRecord {
  const ws = ensureWorld(worldKey);
  // Match by label (case-insensitive) or by primary position
  const norm = normalizeLabel(record.label).toLowerCase();
  let existing = ws.chests.find(c => c.label.toLowerCase() === norm) ||
                 ws.chests.find(c => posEquals(c.primary, record.primary));

  const now = new Date().toISOString();
  if (existing) {
    existing.label = normalizeLabel(record.label);
    existing.notes = record.notes;
    existing.hidden = record.hidden;
    existing.forbidden = !!record.forbidden;
    existing.type = record.type;
    existing.positions = record.positions;
    existing.primary = record.primary;
    existing.dimension = record.dimension;
    existing.updatedAt = now;
    existing.destroyed = false;
    scheduleSave();
    return existing;
  } else {
    const newRec: ChestRecord = {
      ...record,
      id: record.id || `chest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
      destroyed: false,
      forbidden: !!record.forbidden
    };
    ws.chests.push(newRec);
    scheduleSave();
    return newRec;
  }
}

export function removeChest(worldKey: string, idOrLabel: string): boolean {
  const ws = ensureWorld(worldKey);
  const idx = ws.chests.findIndex(c => c.id === idOrLabel || c.label.toLowerCase() === idOrLabel.toLowerCase());
  if (idx !== -1) {
    ws.chests.splice(idx, 1);
    scheduleSave();
    return true;
  }
  return false;
}

export function markDestroyed(worldKey: string, id: string): void {
  const ws = ensureWorld(worldKey);
  const rec = ws.chests.find(c => c.id === id);
  if (rec) {
    rec.destroyed = true;
    rec.updatedAt = new Date().toISOString();
    scheduleSave();
  }
}