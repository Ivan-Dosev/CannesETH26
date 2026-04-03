// Serialises all deployer-wallet transactions across API routes.
// Both create-markets and resolve-pending share the same deployer key;
// without this they race on nonces and fail with "nonce too low" /
// "replacement transaction underpriced".

let _queue: Promise<void> = Promise.resolve();

export function withDeployerLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _queue.then(() => fn());
  // Always advance the queue — even when fn() rejects
  _queue = result.then(
    () => {},
    () => {},
  );
  return result;
}
