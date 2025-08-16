import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ISkillParams, ISkillServiceParams } from '../../types/skillType.js';
import { getWorldKey, loadStore, listChests } from '../../storage/chestStore.js';
import { openContainerAt, closeContainer, getContainerSlotInfo } from '../library/chestUtils.js';
import { runExclusive } from '../library/mutex.js';
import { findClosestItemName } from '../library/findClosestItemName.js';

export const find_items = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams
): Promise<boolean> => {
  const p = params as { items: string[] };
  if (!p.items || !Array.isArray(p.items) || p.items.length === 0) {
    serviceParams.cancelExecution?.();
    bot.emit('alteraBotEndObservation', 'Mistake: Provide items: string[] for find_items.');
    return false;
  }

  try {
    await loadStore();
    const worldKey = getWorldKey(bot);
    const chests = listChests(worldKey, false); // visible chests only by default

    // Resolve each requested name using closest match
    const resolvedNames: Array<{ query: string; name: string | null }> = p.items.map(q => ({
      query: q,
      name: findClosestItemName(bot, { name: q })
    }));

    // Map item -> list of "label (count)"
    const results: Record<string, Array<{ chest: string; count: number }>> = {};
    for (const r of resolvedNames) {
      if (r.name) results[r.query] = [];
      else results[r.query] = []; // will show 'Not found' later
    }

    // Iterate chests and count
    for (const chest of chests) {
      const pos = new Vec3(chest.primary.x, chest.primary.y, chest.primary.z);
      const window = await runExclusive(bot, 'container', async () => {
        return await openContainerAt(bot, pos, serviceParams.signal);
      });

      try {
        const { containerStart, containerEnd } = getContainerSlotInfo(window);
        const totals = new Map<string, number>();
        for (let i = containerStart; i < containerEnd; i++) {
          const it = window.slots[i];
          if (!it) continue;
          totals.set(it.name, (totals.get(it.name) || 0) + it.count);
        }

        for (const r of resolvedNames) {
          if (!r.name) continue;
          const count = totals.get(r.name) || 0;
          if (count > 0) {
            results[r.query].push({ chest: chest.label, count });
          }
        }
      } finally {
        await closeContainer(bot, window);
        // Small delay to avoid spamming the server
        await bot.waitForTicks(2);
      }
    }

    // Format output
    const lines: string[] = [];
    lines.push('Found items:');
    for (const r of resolvedNames) {
      if (!r.name) {
        lines.push(`- ${r.query}: Not found in any labeled chest`);
        continue;
      }
      const entries = results[r.query];
      if (!entries || entries.length === 0) {
        lines.push(`- ${r.query}: Not found in any labeled chest`);
      } else {
        const parts = entries.map(e => `${e.chest} (${e.count})`);
        lines.push(`- ${r.query}: ${parts.join(', ')}`);
      }
    }

    bot.emit('alteraBotEndObservation', lines.join('\n'));
    return true;
  } catch (err: any) {
    bot.emit('alteraBotEndObservation', `Failed to find items: ${err.message || String(err)}`);
    return false;
  }
};