import { Bot } from 'mineflayer';
import { ISkillParams, ISkillServiceParams } from '../../types/skillType.js';
import { findNearbyContainers, humanizeContainerType, formatPosition } from '../library/chestUtils.js';
import { getWorldKey, loadStore, getChestByPosition } from '../../storage/chestStore.js';

export const find_containers = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams
): Promise<boolean> => {
  const rx = typeof (params as any).radius_x === 'number' ? (params as any).radius_x : 16;
  const ry = typeof (params as any).radius_y === 'number' ? (params as any).radius_y : 8;
  const rz = typeof (params as any).radius_z === 'number' ? (params as any).radius_z : 16;

  try {
    await loadStore();
    const worldKey = getWorldKey(bot);
    const containers = await findNearbyContainers(bot, rx, ry, rz);

    // Hide forbidden-labeled containers
    const visible = containers.filter(c => {
      const rec = getChestByPosition(worldKey, { x: c.position.x, y: c.position.y, z: c.position.z });
      return !(rec && rec.forbidden);
    });

    const lines: string[] = [];
    lines.push('=== Nearby Containers ===');

    if (visible.length === 0) {
      lines.push('(none)');
    } else {
      for (const c of visible) {
        const posStr = formatPosition(c.position);
        const rec = getChestByPosition(worldKey, { x: c.position.x, y: c.position.y, z: c.position.z });
        const labelStr = rec ? `[labeled: ${rec.label}]` : '[unlabeled]';
        lines.push(`- ${humanizeContainerType(c.type)} at ${posStr} ${labelStr}`);
      }
    }

    bot.emit('alteraBotEndObservation', lines.join('\n'));
    return true;
  } catch (err: any) {
    bot.emit('alteraBotEndObservation', `Failed to find containers: ${err.message || String(err)}`);
    return false;
  }
};