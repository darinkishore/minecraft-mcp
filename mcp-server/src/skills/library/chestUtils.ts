import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import pathfinderPkg from 'mineflayer-pathfinder';
import { getWorldKey, getChestByPosition } from '../../storage/chestStore.js';

// Extract GoalNear from the pathfinder package
// Note: pathfinderPkg is the default export, goals is a property of it
const { goals } = pathfinderPkg;
const { GoalNear } = goals;

export type ContainerType =
  | 'single_chest'
  | 'double_chest'
  | 'trapped_chest'
  | 'barrel'
  | 'ender_chest'
  | 'shulker_box'
  | 'container';

export interface DetectedContainer {
  type: ContainerType;
  positions: Vec3[];
  primary: Vec3;
}

export function isContainerBlockName(name: string): boolean {
  if (!name) return false;
  return (
    name === 'chest' ||
    name === 'trapped_chest' ||
    name === 'barrel' ||
    name === 'ender_chest' ||
    name.endsWith('_shulker_box') ||
    name === 'shulker_box'
  );
}

export function humanizeContainerType(type: ContainerType): string {
  switch (type) {
    case 'single_chest': return 'Single Chest';
    case 'double_chest': return 'Double Chest';
    case 'trapped_chest': return 'Trapped Chest';
    case 'barrel': return 'Barrel';
    case 'ender_chest': return 'Ender Chest';
    case 'shulker_box': return 'Shulker Box';
    default: return 'Container';
  }
}

export function detectContainerAt(bot: Bot, pos: Vec3): DetectedContainer {
  const block = bot.blockAt(pos);
  if (!block) {
    throw new Error('No block loaded at the specified position');
  }
  const name = block.name;

  if (name === 'chest' || name === 'trapped_chest') {
    const adjPositions = [
      pos.offset(1, 0, 0),
      pos.offset(-1, 0, 0),
      pos.offset(0, 0, 1),
      pos.offset(0, 0, -1)
    ];
    const match = adjPositions.find(p => bot.blockAt(p)?.name === name);
    if (match) {
      const sorted = [pos, match].sort((a, b) => (a.x - b.x) || (a.y - b.y) || (a.z - b.z));
      return {
        type: name === 'chest' ? 'double_chest' : 'trapped_chest',
        positions: sorted,
        primary: sorted[0]
      };
    } else {
      return {
        type: name === 'chest' ? 'single_chest' : 'trapped_chest',
        positions: [pos],
        primary: pos
      };
    }
  }

  if (name === 'barrel') {
    return { type: 'barrel', positions: [pos], primary: pos };
  }
  if (name === 'ender_chest') {
    return { type: 'ender_chest', positions: [pos], primary: pos };
  }
  if (name.endsWith('_shulker_box') || name === 'shulker_box') {
    return { type: 'shulker_box', positions: [pos], primary: pos };
  }

  if (isContainerBlockName(name)) {
    return { type: 'container', positions: [pos], primary: pos };
  }

  throw new Error(`Block at position is not a supported container: ${name}`);
}

export async function navigateNear(bot: Bot, target: Vec3, range = 2, signal?: AbortSignal): Promise<void> {
  const hasPathfinder = !!(bot as any).pathfinder;
  const hasGoalNear = !!GoalNear;
  const logger = (bot as any).logger;
  
  if (hasPathfinder && hasGoalNear) {
    const onAbort = () => {
      try {
        (bot as any).pathfinder.stop();
      } catch {}
    };
    if (signal) signal.addEventListener('abort', onAbort);
    try {
      const goal = new GoalNear(target.x, target.y, target.z, range);
      if (logger?.debug) {
        logger.debug(`Navigating to chest at ${target.x}, ${target.y}, ${target.z}`);
      }
      await (bot as any).pathfinder.goto(goal);
    } catch (err: any) {
      if (logger?.error) {
        logger.error(`Navigation failed: ${err.message || err}`);
      }
      // Re-throw the error so we can see what's wrong
      throw new Error(`Failed to navigate to chest: ${err.message || err}`);
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  } else {
    // Log what's missing
    if (!hasPathfinder && logger?.error) {
      logger.error('Pathfinder plugin not loaded on bot');
    }
    if (!hasGoalNear && logger?.error) {
      logger.error('GoalNear not available from pathfinder module');
    }
    // Report what's missing
    if (!hasPathfinder) {
      throw new Error('Pathfinder plugin not loaded on bot');
    }
    if (!hasGoalNear) {
      throw new Error('GoalNear not available from pathfinder module');
    }
  }
}

export async function openContainerAt(bot: Bot, pos: Vec3, signal?: AbortSignal): Promise<any> {
  // Central forbidden enforcement: deny access to labeled forbidden chests
  const worldKey = getWorldKey(bot);
  const rec = getChestByPosition(worldKey, { x: pos.x, y: pos.y, z: pos.z });
  if (rec && rec.forbidden) {
    throw new Error('Access denied: This chest is forbidden.');
  }

  // For double chests, we need to ensure we're opening the correct position
  // that will give us access to the full double chest inventory
  let targetPos = pos;
  const det = detectContainerAt(bot, pos);
  if (det.type === 'double_chest') {
    // For double chests, use the primary position to ensure consistent access
    targetPos = det.primary;
  }

  const block = bot.blockAt(targetPos);
  if (!block) throw new Error('No block loaded at position');
  await navigateNear(bot, targetPos, 2, signal);
  await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true);
  const window = await (bot as any).openContainer(block);
  return window;
}

export function getContainerSlotInfo(window: any) {
  const totalSlots: number = window.slots.length;
  // 36 slots are the player inventory appended to container windows
  const inventoryStart = typeof window.inventoryStart === 'number' ? window.inventoryStart : Math.max(totalSlots - 36, 0);
  const inventoryEnd = typeof window.inventoryEnd === 'number' ? window.inventoryEnd : totalSlots;
  const containerStart = 0;
  const containerEnd = inventoryStart;
  const containerSize = containerEnd - containerStart;
  return { containerStart, containerEnd, inventoryStart, inventoryEnd, containerSize };
}

export function summarizeContainerContents(window: any): Array<{ name: string; count: number }> {
  const summary: Record<string, number> = {};
  const { containerStart, containerEnd } = getContainerSlotInfo(window);
  for (let i = containerStart; i < containerEnd; i++) {
    const it = window.slots[i];
    if (!it) continue;
    const key = it.name;
    summary[key] = (summary[key] || 0) + it.count;
  }
  return Object.entries(summary).map(([name, count]) => ({ name, count }));
}

export function countFreeContainerSlots(window: any): number {
  const { containerStart, containerEnd } = getContainerSlotInfo(window);
  let free = 0;
  for (let i = containerStart; i < containerEnd; i++) {
    if (!window.slots[i]) free++;
  }
  return free;
}

export async function closeContainer(bot: Bot, window: any): Promise<void> {
  try {
    if (typeof window.close === 'function') {
      await window.close();
      return;
    }
  } catch {}
  try {
    await (bot as any).closeWindow(window);
  } catch {}
}

export function formatPosition(pos: { x: number; y: number; z: number }): string {
  return `${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}`;
}

export async function findNearbyContainers(bot: Bot, rx = 16, ry = 8, rz = 16): Promise<Array<{ type: ContainerType; position: Vec3 }>> {
  const mcBlocks = (bot as any).registry?.blocksByName || {};
  const shulkerNames = Object.keys(mcBlocks).filter((k: string) => k.endsWith('_shulker_box') || k === 'shulker_box');

  const isContainerName = (name: string) => (
    name === 'chest' ||
    name === 'trapped_chest' ||
    name === 'barrel' ||
    name === 'ender_chest' ||
    shulkerNames.includes(name)
  );

  const center = bot.entity?.position?.floored() || new Vec3(0, 0, 0);
  const matches: any = (b: any) => b && isContainerName(b.name);

  const positions = (bot as any).findBlocks({
    point: center,
    matching: matches,
    maxDistance: Math.max(rx, rz),
    count: 512
  }) as Array<{ x: number; y: number; z: number }>;

  const results: Array<{ type: ContainerType; position: Vec3 }> = [];
  const seen = new Set<string>();

  for (const p of positions) {
    const pos = new Vec3(p.x, p.y, p.z);
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (seen.has(key)) continue;

    const det = detectContainerAt(bot, pos);
    if (det.type === 'double_chest') {
      const p0 = det.primary;
      const p1 = det.positions[1];
      seen.add(`${p0.x},${p0.y},${p0.z}`);
      seen.add(`${p1.x},${p1.y},${p1.z}`);
      results.push({ type: 'double_chest', position: p0 });
    } else {
      seen.add(key);
      results.push({ type: det.type, position: pos });
    }
  }

  // Filter by bounding box
  return results.filter(r =>
    Math.abs(r.position.x - center.x) <= rx &&
    Math.abs(r.position.y - center.y) <= ry &&
    Math.abs(r.position.z - center.z) <= rz
  );
}