import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ISkillParams, ISkillServiceParams } from '../../types/skillType.js';
import { openContainerAt, closeContainer, formatPosition } from '../library/chestUtils.js';
import { getWorldKey, loadStore, getChestByLabel, getChestByPosition } from '../../storage/chestStore.js';
import { runExclusive } from '../library/mutex.js';
import { findClosestItemName } from '../library/findClosestItemName.js';

type ChestParam = string | { x: number; y: number; z: number };

function isAll(arg: any): boolean {
  return typeof arg === 'string' && arg.toLowerCase() === 'all';
}

function collectInventoryByName(bot: Bot): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of bot.inventory.items()) {
    map.set(it.name, (map.get(it.name) || 0) + it.count);
  }
  return map;
}

async function depositType(window: any, typeId: number, count: number): Promise<number> {
  // Try a bulk deposit first
  try {
    await window.deposit(typeId, null, count);
    return count;
  } catch {
    // Fallback: attempt 1 by 1 until fail
    let moved = 0;
    for (let i = 0; i < count; i++) {
      try {
        await window.deposit(typeId, null, 1);
        moved++;
      } catch {
        break;
      }
    }
    return moved;
  }
}

export const deposit_items = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams
): Promise<boolean> => {
  const { chest, items, exclude } = params as { chest: ChestParam; items: string[] | 'all'; exclude?: string[] };

  if (!chest || !items) {
    serviceParams.cancelExecution?.();
    bot.emit('alteraBotEndObservation', 'Mistake: Missing required parameters: chest and items for deposit_items.');
    return false;
  }

  // Note: exclude (blacklist) intentionally not implemented per instructions.

  try {
    await loadStore();
    const worldKey = getWorldKey(bot);

    // Resolve chest position
    let posVec: Vec3 | null = null;
    let chestLabel: string | undefined;

    if (typeof chest === 'string') {
      const rec = getChestByLabel(worldKey, chest);
      if (!rec) {
        bot.emit('alteraBotEndObservation', `No labeled chest found with label '${chest}'.`);
        return false;
      }
      posVec = new Vec3(rec.primary.x, rec.primary.y, rec.primary.z);
      chestLabel = rec.label;
    } else {
      posVec = new Vec3(Math.floor(chest.x), Math.floor(chest.y), Math.floor(chest.z));
    }

    if (!posVec) {
      bot.emit('alteraBotEndObservation', 'Could not resolve chest position.');
      return false;
    }

    // Deny access to forbidden-labeled chests
    const recForbCheck = getChestByPosition(worldKey, { x: posVec.x, y: posVec.y, z: posVec.z });
    if (recForbCheck && recForbCheck.forbidden) {
      bot.emit('alteraBotEndObservation', 'Access denied: This chest is forbidden.');
      return false;
    }

    const window = await runExclusive(bot, 'container', async () => {
      return await openContainerAt(bot, posVec!, serviceParams.signal);
    });

    const deposited: string[] = [];
    const failed: string[] = [];

    try {
      if (isAll(items)) {
        // Deposit all inventory items
        const invMap = collectInventoryByName(bot);
        for (const [name, total] of invMap.entries()) {
          const entry = (bot as any).registry.itemsByName[name];
          if (!entry) continue;
          const moved = await depositType(window, entry.id, total);
          if (moved > 0) deposited.push(`${name} x${moved}`);
          if (moved < total) failed.push(`${name} x${total - moved}`);
        }
      } else {
        // Deposit only specified items (use closest matching helper)
        for (const query of items as string[]) {
          const resolved = findClosestItemName(bot, { name: query });
          if (!resolved) {
            failed.push(`${query} x? (no close match)`);
            continue;
          }
          // Count how many we have in inventory for this name
          const total = bot.inventory.items().filter((it: any) => it.name === resolved).reduce((a: number, it: any) => a + it.count, 0);
          if (total <= 0) {
            failed.push(`${resolved} x0`);
            continue;
          }
          const typeId = (bot as any).registry.itemsByName[resolved]?.id;
          if (!typeId) {
            failed.push(`${resolved} x${total} (unknown id)`);
            continue;
          }
          const moved = await depositType(window, typeId, total);
          if (moved > 0) deposited.push(`${resolved} x${moved}`);
          if (moved < total) failed.push(`${resolved} x${total - moved}`);
        }
      }

      const posStr = formatPosition(posVec);
      let msg = `Deposited items into ${chestLabel ? `'${chestLabel}'` : 'chest'} at (${posStr})\n`;
      if (deposited.length > 0) {
        msg += `Deposited: ${deposited.join(', ')}\n`;
      }
      if (failed.length > 0) {
        msg += `Failed (chest full or not found in inventory): ${failed.join(', ')}`;
      }
      if (deposited.length === 0 && failed.length === 0) {
        msg += 'Nothing to deposit.';
      }
      bot.emit('alteraBotEndObservation', msg.trim());
    } finally {
      await closeContainer(bot, window);
    }

    return true;
  } catch (err: any) {
    bot.emit('alteraBotEndObservation', `Failed to deposit items: ${err.message || String(err)}`);
    return false;
  }
};