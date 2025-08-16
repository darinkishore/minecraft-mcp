import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ISkillParams, ISkillServiceParams } from '../../types/skillType.js';
import { openContainerAt, closeContainer, formatPosition, getContainerSlotInfo } from '../library/chestUtils.js';
import { getWorldKey, loadStore, getChestByLabel, getChestByPosition } from '../../storage/chestStore.js';
import { runExclusive } from '../library/mutex.js';
import { findClosestItemName } from '../library/findClosestItemName.js';

type ChestParam = string | { x: number; y: number; z: number };

function isAll(arg: any): boolean {
  return typeof arg === 'string' && arg.toLowerCase() === 'all';
}

async function withdrawType(window: any, typeId: number, count: number): Promise<number> {
  // Try bulk
  try {
    await window.withdraw(typeId, null, count);
    return count;
  } catch {
    // Fallback 1 by 1
    let moved = 0;
    for (let i = 0; i < count; i++) {
      try {
        await window.withdraw(typeId, null, 1);
        moved++;
      } catch {
        break;
      }
    }
    return moved;
  }
}

function countInContainerByName(window: any, name: string): number {
  const { containerStart, containerEnd } = getContainerSlotInfo(window);
  let total = 0;
  for (let i = containerStart; i < containerEnd; i++) {
    const it = window.slots[i];
    if (it && it.name === name) total += it.count;
  }
  return total;
}

export const withdraw_items = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams
): Promise<boolean> => {
  const { chest, items, exclude } = params as { chest: ChestParam; items: string[] | 'all'; exclude?: string[] };

  if (!chest || !items) {
    serviceParams.cancelExecution?.();
    bot.emit('alteraBotEndObservation', 'Mistake: Missing required parameters: chest and items for withdraw_items.');
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

    const withdrew: string[] = [];
    const failed: string[] = [];

    try {
      if (isAll(items)) {
        // Withdraw everything from the container
        const { containerStart, containerEnd } = getContainerSlotInfo(window);
        // Build a name -> total count map
        const totals = new Map<string, { typeId: number; count: number }>();
        for (let i = containerStart; i < containerEnd; i++) {
          const it = window.slots[i];
          if (!it) continue;
          totals.set(it.name, { typeId: it.type, count: (totals.get(it.name)?.count || 0) + it.count });
        }

        for (const [name, info] of totals.entries()) {
          const moved = await withdrawType(window, info.typeId, info.count);
          if (moved > 0) withdrew.push(`${name} x${moved}`);
          if (moved < info.count) failed.push(`${name} x${info.count - moved}`);
        }
      } else {
        // Withdraw specified items (resolve via closest item name)
        for (const query of items as string[]) {
          const resolved = findClosestItemName(bot, { name: query });
          if (!resolved) {
            failed.push(`${query} x? (no close match)`);
            continue;
          }
          const typeId = (bot as any).registry.itemsByName[resolved]?.id;
          if (!typeId) {
            failed.push(`${resolved} x? (unknown id)`);
            continue;
          }
          const total = countInContainerByName(window, resolved);
          if (total <= 0) {
            failed.push(`${resolved} x0`);
            continue;
          }
          const moved = await withdrawType(window, typeId, total);
          if (moved > 0) withdrew.push(`${resolved} x${moved}`);
          if (moved < total) failed.push(`${resolved} x${total - moved}`);
        }
      }

      const posStr = formatPosition(posVec);
      let msg = `Withdrew items from ${chestLabel ? `'${chestLabel}'` : 'chest'} at (${posStr})\n`;
      if (withdrew.length > 0) {
        msg += `Withdrew: ${withdrew.join(', ')}\n`;
      }
      if (failed.length > 0) {
        msg += `Failed (inventory full or not found in chest): ${failed.join(', ')}`;
      }
      if (withdrew.length === 0 && failed.length === 0) {
        msg += 'Nothing to withdraw.';
      }
      bot.emit('alteraBotEndObservation', msg.trim());
    } finally {
      await closeContainer(bot, window);
    }

    return true;
  } catch (err: any) {
    bot.emit('alteraBotEndObservation', `Failed to withdraw items: ${err.message || String(err)}`);
    return false;
  }
};