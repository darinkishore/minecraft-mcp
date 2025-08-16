import { Bot } from 'mineflayer';
import { ISkillParams, ISkillServiceParams } from '../../types/skillType.js';
import {
  findNearbyContainers,
  humanizeContainerType,
  openContainerAt,
  closeContainer,
  summarizeContainerContents,
  countFreeContainerSlots,
  getContainerSlotInfo,
  formatPosition
} from '../library/chestUtils.js';
import { getWorldKey, loadStore, getChestByPosition } from '../../storage/chestStore.js';
import { Vec3 } from 'vec3';
import { runExclusive } from '../library/mutex.js';

export const openNearbyChest = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams
): Promise<boolean> => {
  try {
    await loadStore();
    const worldKey = getWorldKey(bot);

    // Look for nearby containers
    const rx = 12, ry = 6, rz = 12; // reasonable default scan
    const containers = await findNearbyContainers(bot, rx, ry, rz);

    if (!containers || containers.length === 0) {
      bot.emit('alteraBotEndObservation', 'No containers found nearby.');
      return false;
    }

    // Filter out forbidden-labeled containers
    const visible = containers.filter(c => {
      const rec = getChestByPosition(worldKey, { x: c.position.x, y: c.position.y, z: c.position.z });
      return !(rec && rec.forbidden);
    });

    if (visible.length === 0) {
      bot.emit('alteraBotEndObservation', 'Only forbidden containers found nearby; nothing to open.');
      return false;
    }

    // Choose nearest
    const me = bot.entity?.position ?? new Vec3(0, 0, 0);
    visible.sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me));
    const target = visible[0];

    // Open container (mutex prevents concurrent access)
    const window = await runExclusive(bot, 'container', async () => {
      return await openContainerAt(bot, target.position, serviceParams.signal);
    });

    try {
      // Summarize contents
      const contents = summarizeContainerContents(window).sort((a, b) => b.count - a.count);
      const free = countFreeContainerSlots(window);
      const { containerSize } = getContainerSlotInfo(window);

      const rec = getChestByPosition(worldKey, { x: target.position.x, y: target.position.y, z: target.position.z });
      const label = rec?.label;
      const notes = rec?.notes;
      const typeHuman = humanizeContainerType(target.type);
      const posStr = formatPosition(target.position);

      const lines: string[] = [];
      lines.push(`=== ${label ? label : 'Nearby Container'} (${typeHuman}) ===`);
      lines.push(`Position: ${posStr}`);
      lines.push(`Free slots: ${free}/${containerSize}`);
      if (notes) lines.push(`Notes: ${notes}`);
      lines.push('Contents:');
      if (contents.length === 0) {
        lines.push('- (empty)');
      } else {
        for (const it of contents) {
          lines.push(`- ${it.name} x${it.count}`);
        }
      }

      bot.emit('alteraBotEndObservation', lines.join('\n'));
      return true;
    } finally {
      await closeContainer(bot, window);
    }
  } catch (err: any) {
    bot.emit('alteraBotEndObservation', `Failed to open nearby chest: ${err.message || String(err)}`);
    return false;
  }
};