import "server-only";
import { requestDisplaySync, showVehicleDetected } from "./display-board";
import { computeExitCharge, type ExitChargeStatus } from "./exit-charge";
import { checkMonthly } from "./kiosk-payment";
import { findMonthlyRentalByPlate } from "./monthly-rental";
import { sendCommand } from "./mqtt-platform";
import { findInsideEntry, recordAutoEntry, recordAutoExit, type IngestOutcome, type PlateReading } from "./parking-entries";
import type { CameraRole } from "./parking-entry-shared";
import { getRateSettings } from "./rate-settings";
import { COLLECTIONS, getParkingDb } from "./store";
import { checkTaiwanPlate } from "./tw-plate";

// 進出口辨識確認：入口 / 出口攝影機送來即時辨識結果時，每隔 2 秒對同一台攝影機下 SoftTriggerCapture 再辨識 3 次，
// 4 次的車號都接近一致才繼續判斷，通過就對這台攝影機下 Open 開閘：
// - 入口：多數決的車號符合台灣車牌格式 → 開閘並新增進場紀錄
// - 出口：在場內車輛找到這個車號，且不用再繳費（月租車、進場緩衝內、離場結帳緩衝內、已達收費上限，見 exit-charge.ts）
//   → 開閘並把這筆紀錄設為已離場；要繳費 / 補繳時不開閘，請駕駛到繳費機繳費
// 每次確認的過程與結果存在 carpark.gate_verifications，方便查閘門為什麼沒開。

const TRIGGER_INTERVAL_MS = 2000;
const EXTRA_TRIGGERS = 3;
const REQUIRED_READINGS = 1 + EXTRA_TRIGGERS;
/** 最後一次觸發後，最多再等多久收辨識結果 */
const RESULT_WAIT_MS = 3000;
/** 確認結束後這段時間內，同一台攝影機送來同一台車（車號接近）的結果不再開始新的確認，避免晚到的觸發結果又觸發一輪 */
const COOLDOWN_MS = 3000;
/** 每次車號與多數決車號最多差幾個字元仍算「接近一致」 */
const MAX_DIFF = 1;

interface Reading {
  plate: string;
  /** 攝影機原始車號 */
  original: string;
  /** null = 這次沒辨識到車牌（無車、空白車號） */
  reading: PlateReading | null;
  note: string | null;
}

interface Session {
  sn: string;
  role: CameraRole;
  startedAt: Date;
  readings: Reading[];
  triggers: { at: Date; status: string }[];
  /** 3 次觸發都送出後又收到辨識結果、且已滿 4 筆時提早結束等待 */
  wake: (() => void) | null;
}

interface VerifyStore {
  /** 各攝影機進行中的確認 */
  sessions: Map<string, Session>;
  /** 各攝影機上一輪結束的時間與車號 */
  finished: Map<string, { at: number; plates: string[] }>;
}

const globalForVerify = globalThis as typeof globalThis & { _gateVerification?: VerifyStore };
const store: VerifyStore = (globalForVerify._gateVerification ??= { sessions: new Map(), finished: new Map() });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 兩個車號差幾個字元（Levenshtein 距離） */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * 入口 / 出口攝影機的即時辨識結果都交給這裡（含軟觸發回來的結果）。
 * 沒有確認在進行就開始一輪；進行中就當作這一輪的一筆結果。不等確認結束就回傳。
 */
export function submitGateReading(
  sn: string,
  role: CameraRole,
  parsed: { ok: true; reading: PlateReading } | { ok: false; reason: string },
): IngestOutcome {
  const reading: Reading = parsed.ok
    ? { plate: parsed.reading.check.plate, original: parsed.reading.check.original, reading: parsed.reading, note: null }
    : { plate: "", original: "", reading: null, note: parsed.reason };

  const session = store.sessions.get(sn);
  if (session) {
    session.readings.push(reading);
    if (session.triggers.length >= EXTRA_TRIGGERS && session.readings.length >= REQUIRED_READINGS) session.wake?.();
    return { action: "verifying" };
  }
  // 沒有車牌的結果不開始確認；剛確認完的晚到結果也略過
  if (!parsed.ok) return { action: "skipped", reason: parsed.reason };
  const last = store.finished.get(sn);
  if (last && Date.now() - last.at < COOLDOWN_MS && last.plates.some((p) => distance(p, reading.plate) <= MAX_DIFF)) {
    return { action: "skipped", reason: "剛確認完這台車，略過晚到的辨識結果" };
  }

  const started: Session = { sn, role, startedAt: new Date(), readings: [reading], triggers: [], wake: null };
  store.sessions.set(sn, started);
  // 顯示板顯示「辨識到車輛時」的臨時訊息
  showVehicleDetected(sn, role, reading.plate);
  run(started).catch((error) => console.error(`[gate-verify] ${sn} 確認失敗:`, error instanceof Error ? error.message : error));
  return { action: "verifying" };
}

async function run(session: Session): Promise<void> {
  const { sn } = session;
  try {
    for (let i = 0; i < EXTRA_TRIGGERS; i++) {
      await sleep(TRIGGER_INTERVAL_MS);
      // 不等 Receipt 才排下一次，間隔固定 2 秒；Receipt 結果記在 triggers 裡
      const trigger = { at: new Date(), status: "sending" };
      session.triggers.push(trigger);
      sendCommand(sn, "SoftTriggerCapture", null, TRIGGER_INTERVAL_MS)
        .then((r) => (trigger.status = r.status))
        .catch((error) => (trigger.status = error instanceof Error ? error.message : "下發失敗"));
    }
    // 等最後一次觸發的結果回來（或逾時）
    await Promise.race([sleep(RESULT_WAIT_MS), new Promise<void>((resolve) => (session.wake = resolve))]);
  } finally {
    store.sessions.delete(sn);
    store.finished.set(sn, { at: Date.now(), plates: session.readings.map((r) => r.plate).filter(Boolean) });
  }
  await decide(session);
}

/** 4 次車號是否接近一致；一致回傳多數決車號，否則回傳原因 */
function agree(readings: Reading[]): { plate: string } | { reason: string } {
  if (readings.length < REQUIRED_READINGS) {
    return { reason: `只收到 ${readings.length} 次辨識結果（需要 ${REQUIRED_READINGS} 次），攝影機可能沒有回應軟觸發` };
  }
  const missing = readings.findIndex((r) => !r.reading);
  if (missing >= 0) return { reason: `第 ${missing + 1} 次沒有辨識到車牌` };
  // 多數決：出現最多次的車號；同票取先出現的
  const plates = readings.map((r) => r.plate);
  const counts = new Map<string, number>();
  for (const p of plates) counts.set(p, (counts.get(p) ?? 0) + 1);
  const [best, votes] = [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
  const far = plates.filter((p) => distance(p, best) > MAX_DIFF);
  if (votes < 2) return { reason: `${plates.join("、")} 每次都不一樣` };
  if (far.length) return { reason: `${far.join("、")} 與 ${best} 差太多` };
  return { plate: best };
}

const PASS_LABELS: Record<Exclude<ExitChargeStatus, "due">, string> = {
  monthly: "月租車",
  entryBuffer: "進場緩衝時間內",
  exitBuffer: "已繳費，離場結帳緩衝時間內",
  capped: "已達收費上限",
};

/** 判斷這一輪的車號，通過就開閘並記錄進場 / 出場 */
async function decide(session: Session): Promise<void> {
  const { sn, role, readings } = session;
  const result = agree(readings);
  let plate: string | null = null;
  let reason: string | null = "reason" in result ? result.reason : null;
  /** 出口放行的理由，例如「月租車」「已達收費上限」 */
  let pass: string | null = null;
  let record: (() => Promise<IngestOutcome>) | null = null;

  if ("plate" in result) {
    // 用車號就是多數決車號的第一筆當照片與辨識結果；時間用第一次辨識的時間
    const chosen = { ...readings.find((r) => r.plate === result.plate)!.reading!, time: readings[0].reading!.time };
    if (role === "entry") {
      if (!checkTaiwanPlate(result.plate).valid) reason = `${result.plate} 不符合台灣車牌格式`;
      else {
        plate = result.plate;
        record = () => recordAutoEntry(chosen);
      }
    } else {
      // 先用多數決車號找場內車輛，找不到再用其他幾次的車號（含攝影機原始車號）找
      const entry = await findInsideEntry([result.plate, ...readings.flatMap((r) => [r.plate, r.original])]);
      if (!entry) reason = `場內車輛找不到 ${result.plate}`;
      else {
        const now = new Date();
        const monthly = checkMonthly(await findMonthlyRentalByPlate(entry.plate), new Date(entry.entryTime), now);
        const charge = computeExitCharge(await getRateSettings(), entry, monthly, now);
        if (charge.status !== "due") {
          pass = charge.status === "monthly" && monthly ? `月租車（${monthly.no} ${monthly.name}）` : PASS_LABELS[charge.status];
        } else if (charge.payTime) {
          reason = `${entry.plate} 超過離場結帳緩衝時間，需補繳 ${charge.due} 元（已結帳 ${charge.paid} 元）`;
        } else {
          const note = monthly && monthly.status !== "valid" ? `（月租${{ expired: "已逾期", disabled: "已停用", notStarted: "尚未開始" }[monthly.status]}）` : "";
          reason = `${entry.plate} 尚未繳費，應繳 ${charge.due} 元${note}`;
        }
        if (pass) {
          plate = entry.plate;
          record = () => recordAutoExit(entry.id, chosen);
        }
      }
    }
  }

  let gate: string | null = null;
  let outcome: IngestOutcome | null = null;
  if (plate && record) {
    const [gateResult, recorded] = await Promise.allSettled([sendCommand(sn, "Open", null), record()]);
    gate = gateResult.status === "fulfilled" ? gateResult.value.status : String(gateResult.reason);
    if (recorded.status === "fulfilled") {
      outcome = recorded.value;
      // 進出場改變了車位數，更新顯示板
      requestDisplaySync();
    }
    else {
      const message = recorded.reason instanceof Error ? recorded.reason.message : String(recorded.reason);
      reason = `開閘${gate}，但${role === "entry" ? "進場" : "出場"}紀錄寫入失敗：${message}`;
    }
  }

  const label = role === "entry" ? "入口" : "出口";
  console.log(
    `[gate-verify] ${label} ${sn} ${readings.map((r) => r.plate).join(",")} →`,
    plate ? `${plate}${pass ? ` ${pass}` : ""} 開閘 ${gate}` : `不開閘：${reason}`,
    outcome ?? "",
  );
  const db = await getParkingDb();
  await db.collection(COLLECTIONS.gateVerifications).insertOne({
    sn,
    role,
    passed: plate !== null,
    plate,
    pass,
    reason,
    gate,
    entryNo: outcome && "no" in outcome ? outcome.no : null,
    outcome: outcome?.action ?? null,
    readings: readings.map((r) => ({
      plate: r.plate,
      original: r.original,
      resultId: r.reading?.resultId ?? null,
      command: r.reading?.command ?? null,
      note: r.note,
    })),
    triggers: session.triggers,
    startedAt: session.startedAt,
    finishedAt: new Date(),
  });
}
