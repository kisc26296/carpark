import { scanLan } from "@/lib/parking/network-scan";

// Ping 掃描本機區網，列出有回應的設備 IP（搭配 reverse DNS 猜主機名稱）
export async function GET() {
  try {
    const result = await scanLan();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "掃描失敗" },
      { status: 500 },
    );
  }
}
