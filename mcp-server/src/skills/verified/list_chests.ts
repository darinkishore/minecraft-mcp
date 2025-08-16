import { Bot } from 'mineflayer';
import { ISkillParams, ISkillServiceParams } from '../../types/skillType.js';
import { getWorldKey, loadStore, listChests } from '../../storage/chestStore.js';

export const list_chests = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams
): Promise<boolean> => {
  const includeHidden = !!(params as any).include_hidden;

  try {
    await loadStore();
    const worldKey = getWorldKey(bot);
    const all = listChests(worldKey, includeHidden);
    const allHidden = listChests(worldKey, true);
    const hiddenCount = Math.max(allHidden.length - all.length, 0);

    const lines: string[] = [];
    lines.push('=== Labeled Chests ===');
    if (all.length === 0) {
      lines.push('(none)');
    } else {
      all.forEach((c, idx) => {
        const pos = `${c.primary.x}, ${c.primary.y}, ${c.primary.z}`;
        const notesStr = c.notes ? ` - ${c.notes}` : '';
        lines.push(`${idx + 1}. ${c.label} (${pos})${notesStr}`);
      });
    }
    if (!includeHidden && hiddenCount > 0) {
      lines.push(`[${hiddenCount} hidden chests not shown]`);
    }

    bot.emit('alteraBotEndObservation', lines.join('\n'));
    return true;
  } catch (err: any) {
    bot.emit('alteraBotEndObservation', `Failed to list chests: ${err.message || String(err)}`);
    return false;
  }
};