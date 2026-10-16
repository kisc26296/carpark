import { getHopperState, runHopperAction, updateHopperSettings } from "@/lib/cash-device/protocols/hopper";
import { HOPPER_MODELS, isHopperDevice, type HopperAction, type HopperModel } from "@/lib/cash-device/shared";

export const dynamic = "force-dynamic";

const ACTIONS: HopperAction[] = [
  "payoutNoReply",
  "payoutReply",
  "payoutRemain",
  "status",
  "remain",
  "reset",
  "empty",
  "stop",
];

const DEVICE_ERROR = "device 必須是 hopper1 / hopper5 / hopper10 / hopper50";

// 讀取某台找零錢機（出幣機）狀態：GET /api/cash-device/hopper?device=hopper1|hopper5|hopper10|hopper50
export async function GET(request: Request) {
  const device = new URL(request.url).searchParams.get("device");
  if (!isHopperDevice(device)) return Response.json({ ok: false, error: DEVICE_ERROR }, { status: 400 });
  return Response.json({ ok: true, state: await getHopperState(device) });
}

// 找零錢機操作：POST /api/cash-device/hopper
// body: { device, action: "payoutNoReply"|"payoutReply"|"payoutRemain"|"status"|"remain"|"reset"|"empty"|"stop", count?: 1~255 }
//    或 { device, settings: { address: 0~3, model: "MH"|"EMH"|"UCH" } } 儲存出幣機位址與機型
export async function POST(request: Request) {
  let body: { device?: unknown; action?: unknown; count?: unknown; settings?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  const { device } = body;
  if (!isHopperDevice(device)) return Response.json({ ok: false, error: DEVICE_ERROR }, { status: 400 });

  try {
    if (body.settings !== undefined) {
      const raw = body.settings as { address?: unknown; model?: unknown };
      const address = Number(raw?.address);
      if (!Number.isInteger(address) || address < 0 || address > 3) {
        return Response.json({ ok: false, error: "address 必須是 0～3" }, { status: 400 });
      }
      if (!(HOPPER_MODELS as readonly unknown[]).includes(raw.model)) {
        return Response.json({ ok: false, error: `model 必須是 ${HOPPER_MODELS.join(" / ")}` }, { status: 400 });
      }
      return Response.json({
        ok: true,
        state: await updateHopperSettings(device, { address, model: raw.model as HopperModel }),
      });
    }

    if (!ACTIONS.includes(body.action as HopperAction)) {
      return Response.json({ ok: false, error: `action 必須是 ${ACTIONS.join(" / ")}` }, { status: 400 });
    }
    const count = body.count === undefined ? undefined : Number(body.count);
    return Response.json({ ok: true, state: await runHopperAction(device, body.action as HopperAction, count) });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "操作失敗", state: await getHopperState(device) },
      { status: 500 },
    );
  }
}
