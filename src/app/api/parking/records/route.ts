import { COLLECTIONS, getParkingDb } from "@/lib/parking/store";

const KINDS = {
  messages: { collection: COLLECTIONS.messages, sort: { receivedAt: -1 } },
  commands: { collection: COLLECTIONS.commands, sort: { sentAt: -1 } },
  devices: { collection: COLLECTIONS.devices, sort: { lastSeenAt: -1 } },
  results: { collection: COLLECTIONS.plateResults, sort: { created_at: -1 } },
} as const;

type Kind = keyof typeof KINDS;

const isKind = (v: string | null): v is Kind => v !== null && v in KINDS;

// 查詢紀錄：GET /api/parking/records?kind=messages|commands|devices|results&sn=&limit=
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  if (!isKind(kind)) {
    return Response.json({ error: `kind 必須是 ${Object.keys(KINDS).join(" / ")}` }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 500);
  const sn = params.get("sn");
  const filter = sn ? (kind === "results" ? { device_sn: sn } : { sn }) : {};

  const db = await getParkingDb();
  const { collection, sort } = KINDS[kind];
  // 圖片 Base64 可能很大，列表不回傳
  const projection = kind === "results" ? { image_base64: 0, "raw.picNFile": 0, "raw.picMinFile": 0 } : {};
  const items = await db.collection(collection).find(filter, { projection }).sort(sort).limit(limit).toArray();
  return Response.json({ kind, count: items.length, items });
}

// 清除測試紀錄：DELETE /api/parking/records?kind=messages|commands|devices|results|all
export async function DELETE(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind");
  const targets: Kind[] = kind === "all" ? (Object.keys(KINDS) as Kind[]) : isKind(kind) ? [kind] : [];
  if (targets.length === 0) {
    return Response.json({ error: "kind 必須是 messages / commands / devices / results / all" }, { status: 400 });
  }

  const db = await getParkingDb();
  const deleted: Record<string, number> = {};
  for (const target of targets) {
    const res = await db.collection(KINDS[target].collection).deleteMany({});
    deleted[target] = res.deletedCount;
  }
  return Response.json({ ok: true, deleted });
}
