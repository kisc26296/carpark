import { onCashDeviceEvent, type CashDeviceEvent } from "@/lib/cash-device/events";
import { getBillState } from "@/lib/cash-device/protocols/bill-acceptor";
import { getCoinState } from "@/lib/cash-device/protocols/coin-acceptor";
import { getHopperState } from "@/lib/cash-device/protocols/hopper";
import { getLogs, getStatuses } from "@/lib/cash-device/serial-manager";
import { HOPPER_DEVICES } from "@/lib/cash-device/shared";

// 現金設備即時監測用 SSE：連線時先送 snapshot（目前狀態、最近的收發紀錄、紙鈔機、硬幣接收器、找零錢機狀態），
// 之後每筆收發資料（log）、連線狀態變化（status）、紙鈔機（bill）、硬幣接收器（coin）、找零錢機（hopper）狀態變化都即時推送。
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const [bill, coin, ...hopperStates] = await Promise.all([
    getBillState(),
    getCoinState(),
    ...HOPPER_DEVICES.map((d) => getHopperState(d)),
  ]);
  const hoppers = Object.fromEntries(HOPPER_DEVICES.map((d, i) => [d, hopperStates[i]]));
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // controller 可能已經關閉，忽略
        }
      };

      send("snapshot", { statuses: getStatuses(), logs: getLogs(), bill, coin, hoppers });
      unsubscribe = onCashDeviceEvent((event: CashDeviceEvent) => {
        if (event.type === "log") send("log", event.entry);
        else if (event.type === "status") send("status", event.status);
        else if (event.type === "hopper") send("hopper", { device: event.device, state: event.state });
        else send(event.type, event.state);
      });

      // 定期送心跳註解，避免中間的代理或瀏覽器把閒置連線斷掉
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // controller 可能已經關閉，忽略
        }
      }, 20000);
    },
    cancel: cleanup,
  });

  request.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
