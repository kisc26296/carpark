import { getAllConfigs } from "@/lib/cash-device/config-store";
import { listComPorts } from "@/lib/cash-device/serial-manager";
import type { ComPortInfo } from "@/lib/cash-device/shared";

// 主機上的 COM port 會隨 USB 轉 RS232 插拔變動，每次都即時列出
export const dynamic = "force-dynamic";

// 列出主機的 COM port，並標示設定中被哪台設備使用：GET /api/cash-device/ports
export async function GET() {
  try {
    const [ports, configs] = await Promise.all([listComPorts(), getAllConfigs()]);
    const items: ComPortInfo[] = ports.map((p) => ({
      ...p,
      usedBy: configs.find((c) => c.port.toUpperCase() === p.path.toUpperCase())?.device ?? null,
    }));
    return Response.json({ ok: true, ports: items });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "讀取 COM port 失敗" },
      { status: 500 },
    );
  }
}
