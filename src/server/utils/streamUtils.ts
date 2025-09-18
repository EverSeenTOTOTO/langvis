interface CreatePeriodicSaveStreamOptions {
  /**
   * Called for each chunk received
   */
  onChunk: (chunk: string, content: string) => Promise<void>;

  /**
   * Called when the stream is complete
   */
  onComplete: (content: string, chunkCount: number) => Promise<void>;

  /**
   * Called if the stream is aborted
   */
  onError: (reason: unknown) => void;

  /**
   * How often to trigger periodic saves (in chunks)
   * @default 10
   */
  saveInterval?: number;

  /**
   * Called periodically based on saveInterval
   */
  onPeriodicSave?: (content: string, chunkCount: number) => Promise<void>;
}

export function createPeriodicSaveStream({
  onChunk,
  onComplete,
  onError,
  saveInterval = 10,
  onPeriodicSave,
}: CreatePeriodicSaveStreamOptions) {
  let content = '';
  let chunkCount = 0;
  let lastSavedAt = 0;

  return new WritableStream({
    write: async (chunk: string) => {
      // Call the chunk handler for every chunk
      await onChunk(chunk, content);

      content += chunk;
      chunkCount++;

      // Trigger periodic save callback based on interval
      if (chunkCount - lastSavedAt >= saveInterval) {
        await onPeriodicSave?.(content, chunkCount);
        lastSavedAt = chunkCount;
      }
    },
    close: () => onComplete(content, chunkCount),
    abort: onError,
  });
}
