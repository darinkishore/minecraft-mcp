import type { Bot } from 'mineflayer';

const locks = new Map<string, Promise<any>>();

export async function runExclusive<T>(bot: Bot, key: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = `${bot.username || 'bot'}:${key}`;
  const prev = locks.get(lockKey) || Promise.resolve();
  let resolveNext: (value: any) => void;
  const next = new Promise(res => { resolveNext = res; });
  locks.set(lockKey, prev.then(() => next));

  try {
    await prev;
    const result = await fn();
    resolveNext!(undefined);
    return result;
  } catch (err) {
    resolveNext!(undefined);
    throw err;
  } finally {
    // Cleanup if this was the last in chain
    if (locks.get(lockKey) === next) {
      locks.delete(lockKey);
    }
  }
}