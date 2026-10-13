// All read-modify-write cycles on storage go through this lock so the tick loop,
// the executor and UI commands never overwrite each other.
let chain: Promise<unknown> = Promise.resolve();

export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}
