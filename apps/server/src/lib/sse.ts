import type { StreamEvent } from '@luma/shared';

export type EventEmitter = (event: StreamEvent) => void;

/** Heartbeats keep the transport alive; comments never imply teaching progress.
 * Only the producer emits persisted run outcomes. Closing a reader aborts its
 * producer, so an abandoned stream cannot keep spending model budget.
 */
export function sseResponse(
  produce: (emit: EventEmitter, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
  heartbeatMs = 10_000,
): Response {
  const encoder = new TextEncoder();
  const connection = new AbortController();
  const combined = AbortSignal.any([signal, connection.signal]);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (text: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(text)); }
        catch { connection.abort(); closed = true; }
      };
      const heartbeat = setInterval(() => write(': heartbeat\n\n'), heartbeatMs);
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* Reader already disconnected. */ }
      };
      const onAbort = () => { clearInterval(heartbeat); close(); };
      combined.addEventListener('abort', onAbort, { once: true });
      try {
        combined.throwIfAborted();
        await produce((event) => write(`data: ${JSON.stringify(event)}\n\n`), combined);
      } catch {
        // Do not log upstream errors/headers or invent a terminal business event.
        if (!combined.aborted) console.error('[sse] 流式产出中断；客户端需回查运行状态');
      } finally {
        clearInterval(heartbeat);
        combined.removeEventListener('abort', onAbort);
        close();
      }
    },
    cancel() { connection.abort(new Error('客户端已停止接收')); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
