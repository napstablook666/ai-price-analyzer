const keyedLocks = new Map();

export function withKeyedLock(key, task) {
  const previous = keyedLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => {
    release = resolve;
  });
  keyedLocks.set(key, current);
  return previous.then(task).finally(() => {
    release();
    if (keyedLocks.get(key) === current) keyedLocks.delete(key);
  });
}

export async function runWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, Number(limit) || 1));
  const worker = async slot => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      const startedAt = Date.now();
      try {
        results[index] = { status: "fulfilled", value: await task(items[index], index, slot), slot, startedAt };
      } catch (reason) {
        results[index] = { status: "rejected", reason, slot, startedAt };
      }
    }
  };
  await Promise.allSettled(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));
  return results;
}
