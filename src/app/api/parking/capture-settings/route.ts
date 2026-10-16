import fs from "node:fs/promises";
import {
  clearCaptureDir,
  getCaptureSettings,
  setCaptureDir,
  type CaptureTarget,
} from "@/lib/parking/capture-settings";

// 辨識圖片的本機儲存資料夾設定：共用資料夾（default），以及入口（entry）、出口（exit）攝影機各自的資料夾
// GET：取得目前設定；POST { dir, target? }：設定（資料夾不存在會自動建立）；DELETE ?target=：清除設定
// target 省略時為共用資料夾（相容原本只有一個資料夾的用法）

const TARGETS: CaptureTarget[] = ["default", "entry", "exit"];
const toTarget = (v: unknown): CaptureTarget | null =>
  v === undefined || v === null || v === "" ? "default" : TARGETS.includes(v as CaptureTarget) ? (v as CaptureTarget) : null;

async function isDirectory(dir: string | null): Promise<boolean> {
  if (!dir) return false;
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

export async function GET() {
  const { dir, entryDir, exitDir } = await getCaptureSettings();
  const [exists, entryExists, exitExists] = await Promise.all([dir, entryDir, exitDir].map(isDirectory));
  return Response.json({ dir, exists, entryDir, entryExists, exitDir, exitExists });
}

export async function POST(request: Request) {
  let body: { dir?: unknown; target?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "body 不是合法的 JSON" }, { status: 400 });
  }
  const dir = typeof body.dir === "string" ? body.dir.trim() : "";
  if (!dir) return Response.json({ ok: false, error: "缺少 dir" }, { status: 400 });
  const target = toTarget(body.target);
  if (!target) return Response.json({ ok: false, error: "target 必須是 default / entry / exit" }, { status: 400 });

  try {
    const resolved = await setCaptureDir(dir, target);
    return Response.json({ ok: true, dir: resolved });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "設定失敗" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const target = toTarget(new URL(request.url).searchParams.get("target"));
  if (!target) return Response.json({ ok: false, error: "target 必須是 default / entry / exit" }, { status: 400 });
  await clearCaptureDir(target);
  return Response.json({ ok: true });
}
