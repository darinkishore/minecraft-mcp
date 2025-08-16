import { Bot } from 'mineflayer';
import { ISkillParams, ISkillServiceParams } from '../../types/skillType.js';

export const get_inventory = async (
  bot: Bot,
  params: ISkillParams,
  serviceParams: ISkillServiceParams
): Promise<boolean> => {
  try {
    const slots = (bot.inventory as any).slots as Array<any>;
    // Main inventory is slots 9..44 inclusive (36 slots)
    let used = 0;
    for (let i = 9; i <= 44; i++) {
      if (slots[i]) used++;
    }

    const items: Record<string, number> = {};
    for (const it of bot.inventory.items()) {
      items[it.name] = (items[it.name] || 0) + it.count;
    }
    const sorted = Object.entries(items).sort((a, b) => b[1] - a[1]);

    const lines: string[] = [];
    lines.push(`=== Inventory (${used}/36 slots used) ===`);
    if (sorted.length === 0) {
      lines.push('- (empty)');
    } else {
      for (const [name, count] of sorted) {
        lines.push(`- ${name} x${count}`);
      }
    }

    bot.emit('alteraBotEndObservation', lines.join('\n'));
    return true;
  } catch (err: any) {
    bot.emit('alteraBotEndObservation', `Failed to read inventory: ${err.message || String(err)}`);
    return false;
  }
};