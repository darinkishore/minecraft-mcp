import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ISkillParams, ISkillServiceParams } from '../../types/skillType.js';
import { detectContainerAt, humanizeContainerType, openContainerAt, summarizeContainerContents, countFreeContainerSlots, getContainerSlotInfo, closeContainer, formatPosition } from '../library/chestUtils.js';
import { getWorldKey, loadStore, getChestByLabel, getChestByPosition } from '../../storage/chestStore.js';
import { runExclusive } from '../library/mutex.js';

export const check_chest = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams
): Promise<boolean> => {
  const p = params as { label?: string; x?: number; y?: number; z?: number };
  const hasLabel = typeof p.label === 'string' && p.label.trim() !== '';
  const hasCoords = typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number';

  if (!hasLabel && !hasCoords) {
    serviceParams.cancelExecution?.();
    bot.emit('alteraBotEndObservation', 'Mistake: Provide either label or coordinates {x, y, z} for check_chest.');
    return false;
  }

  try {
    await loadStore();
    const worldKey = getWorldKey(bot);
    let posVec: Vec3 | null = null;
    let label: string | undefined;
    let notes: string | undefined;
    let typeHuman = 'Container';

    if (hasLabel) {
      const rec = getChestByLabel(worldKey, p.label!);
      if (!rec) {
        bot.emit('alteraBotEndObservation', `No labeled chest found with label '${p.label}'.`);
        return false;
      }
      label = rec.label;
      notes = rec.notes;
      posVec = new Vec3(rec.primary.x, rec.primary.y, rec.primary.z);
      typeHuman = humanizeContainerType(rec.type as any);
    } else if (hasCoords) {
      posVec = new Vec3(Math.floor(p.x!), Math.floor(p.y!), Math.floor(p.z!));
      // Try to resolve label if exists
      const rec = getChestByPosition(worldKey, { x: posVec.x, y: posVec.y, z: posVec.z });
      if (rec) {
        label = rec.label;
        notes = rec.notes;
        typeHuman = humanizeContainerType(rec.type as any);
      } else {
        const det = detectContainerAt(bot, posVec);
        typeHuman = humanizeContainerType(det.type);
      }
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

    try {
      const contents = summarizeContainerContents(window).sort((a, b) => b.count - a.count);
      const free = countFreeContainerSlots(window);
      const { containerSize } = getContainerSlotInfo(window);

      const header = `=== ${label ? label : 'Unlabeled Chest'} (${typeHuman}) ===`;
      const lines: string[] = [];
      lines.push(header);
      lines.push(`Position: ${formatPosition(posVec)}`);
      lines.push(`Free slots: ${free}/${containerSize}`);
      if (notes) {
        lines.push(`Notes: ${notes}`);
      }
      lines.push('Contents:');
      if (contents.length === 0) {
        lines.push('- (empty)');
      } else {
        for (const it of contents) {
          lines.push(`- ${it.name} x${it.count}`);
        }
      }

      bot.emit('alteraBotEndObservation', lines.join('\n'));
    } finally {
      await closeContainer(bot, window);
    }

    return true;
  } catch (err: any) {
    bot.emit('alteraBotEndObservation', `Failed to check chest: ${err.message || String(err)}`);
    return false;
  }
};