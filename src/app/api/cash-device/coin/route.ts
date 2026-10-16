import { getCoinState, runCoinAction, updateCoinSettings } from "@/lib/cash-device/protocols/coin-acceptor";
import type { CoinAction } from "@/lib/cash-device/shared";

export const dynamic = "force-dynamic";

const ACTIONS: CoinAction[] = [
  "enable",
  "disable",
  "status",
  "version",
  "info",
  "channels",
  "sorterRead",
  "sorterWrite",
  "fishingOn",
  "fishingOff",
  "clearAmount",
];

// 讀取硬幣接收器狀態：GET /api/cash-device/coin
export async function GET() {
  return Response.json({ ok: true, state: await getCoinState() });
}

// 硬幣接收器操作：POST /api/cash-device/coin
// body: { action: "enable"|"disable"|"status"|"version"|"info"|"channels"|"sorterRead"|"sorterWrite"|"fishingOn"|"fishingOff"|"clearAmount", sorter?: number[8] }
//    或 { settings: { enabledChannels: number[] } } 儲存允許收的硬幣通道（1～16）
export async function POST(request: Request) {
  let body: { action?: unknown; sorter?: unknown; settings?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }

  try {
    if (body.settings !== undefined) {
      const raw = (body.settings as { enabledChannels?: unknown })?.enabledChannels;
      if (!Array.isArray(raw)) {
        return Response.json({ ok: false, error: "settings 需要 enabledChannels（陣列）" }, { status: 400 });
      }
      const enabledChannels = [...new Set(raw.map(Number))]
        .filter((c) => Number.isInteger(c) && c >= 1 && c <= 16)
        .sort((a, b) => a - b);
      return Response.json({ ok: true, state: await updateCoinSettings({ enabledChannels }) });
    }

    if (!ACTIONS.includes(body.action as CoinAction)) {
      return Response.json({ ok: false, error: `action 必須是 ${ACTIONS.join(" / ")}` }, { status: 400 });
    }
    const sorter = Array.isArray(body.sorter) ? body.sorter.map(Number) : undefined;
    return Response.json({ ok: true, state: await runCoinAction(body.action as CoinAction, sorter) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "操作失敗", state: await getCoinState() },
      { status: 500 },
    );
  }
}
