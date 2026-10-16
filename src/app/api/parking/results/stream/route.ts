import { onPlateResult, type PlateResultEvent } from "@/lib/parking/result-events";

// 即時監測用 SSE：車牌辨識結果一存檔成功就會透過這條連線推給前端，不用前端自己輪詢。
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: PlateResultEvent) => {
        controller.enqueue(encoder.encode(`event: result\ndata: ${JSON.stringify(event)}\n\n`));
      };
      unsubscribe = onPlateResult(send);

      // 連線剛建立先送一個 ready 事件，前端可以用來顯示「監測中」
      controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));

      // 定期送心跳註解，避免中間的代理或瀏覽器把閒置連線斷掉
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // controller 可能已經關閉，忽略
        }
      }, 20000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  request.signal.addEventListener("abort", () => {
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
