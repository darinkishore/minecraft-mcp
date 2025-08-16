import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ISkillParams, ISkillServiceParams } from '../../types/skillType.js';
import { detectContainerAt, humanizeContainerType, formatPosition } from '../library/chestUtils.js';
import { ChestRecord, getWorldKey, loadStore, upsertChest, saveStore } from '../../storage/chestStore.js';

export const label_chest = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams
): Promise<boolean> => {
  const { x, y, z, label, notes, hidden, forbidden } = params as { x: number; y: number; z: number; label: string; notes?: string; hidden?: boolean; forbidden?: boolean };

  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof label !== 'string' || label.trim() === '') {
    serviceParams.cancelExecution?.();
    bot.emit('alteraBotEndObservation', 'Mistake: Missing required parameters x, y, z, and label for label_chest.');
    return false;
  }

  try {
    await loadStore();
    const worldKey = getWorldKey(bot);
    const pos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    const det = detectContainerAt(bot, pos);

    const record: ChestRecord = {
      id: '',
      label: label.trim(),
      notes,
      hidden: !!hidden,
      forbidden: !!forbidden,
      type: det.type,
      positions: det.positions.map(p => ({ x: p.x, y: p.y, z: p.z })),
      primary: { x: det.primary.x, y: det.primary.y, z: det.primary.z },
      dimension: bot.game?.dimension || 'overworld',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      destroyed: false
    };

    const saved = upsertChest(worldKey, record);
    await saveStore();

    const primaryStr = formatPosition(det.primary);
    const typeHuman = humanizeContainerType(det.type);
    const tag = saved.forbidden ? ' [FORBIDDEN]' : '';
    bot.emit('alteraBotEndObservation', `Labeled chest at (${primaryStr}) as '${saved.label}' (${typeHuman})${tag}`);
    return true;
  } catch (err: any) {
    bot.emit('alteraBotEndObservation', `Failed to label chest: ${err.message || String(err)}`);
    return false;
  }
};