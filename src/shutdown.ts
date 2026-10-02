/** Close Nest (including BullMQ workers) before shutting down telemetry. */
export function createShutdown(
  closeApplication: () => Promise<unknown>,
  shutdownTelemetry: () => Promise<void>,
  exit: (code: number) => void,
  timeoutMs = 10_000,
): () => Promise<void> {
  let pending: Promise<void> | undefined;
  let exited = false;
  const finish = (code: number) => {
    if (exited) return;
    exited = true;
    exit(code);
  };

  return () => {
    pending ??= Promise.resolve().then(async () => {
      const deadline = setTimeout(() => finish(1), timeoutMs);
      let code = 0;
      try {
        await closeApplication();
      } catch {
        code = 1;
      }
      try {
        await shutdownTelemetry();
      } catch {
        code = 1;
      } finally {
        clearTimeout(deadline);
        finish(code);
      }
    });
    return pending;
  };
}
