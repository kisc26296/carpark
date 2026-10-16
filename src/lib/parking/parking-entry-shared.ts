// 車輛進出場紀錄：前後端共用的型別與顯示格式，不可引用 server-only 模組

export type CameraRole = "entry" | "exit";

export const CAMERA_ROLE_LABELS: Record<CameraRole, string> = { entry: "入口", exit: "出口" };

export interface ParkingEntry {
  id: string;
  /** 流水編號，自動遞增 */
  no: number;
  plate: string;
  /** 攝影機原本辨識的車號；有依台灣車牌格式修正時才有值 */
  plateRaw: string | null;
  /** 車號是否符合台灣車牌格式 */
  plateValid: boolean;
  /** 修正內容或格式問題說明 */
  plateNote: string | null;
  /** ISO 時間字串 */
  entryTime: string;
  /** 入場的攝影機序號；手動新增時為 null */
  entryDeviceSn: string | null;
  /** 對應 plate_results 的 _id */
  entryResultId: string | null;
  entryImagePath: string | null;
  exited: boolean;
  exitTime: string | null;
  exitDeviceSn: string | null;
  exitResultId: string | null;
  exitImagePath: string | null;
  /** 出場的補充說明，例如「再次進場，自動結束舊紀錄」 */
  exitNote: string | null;
  /** 繳費欄位，繳費流程接上之前都是空的 */
  payTime: string | null;
  invoiceNo: string;
  amount: number | null;
  /** auto：攝影機辨識自動建立；manual：頁面手動新增 */
  source: "auto" | "manual";
  createdAt: string;
  updatedAt: string;
}

export interface CameraInfo {
  sn: string;
  /** 攝影機在區網的 IP（設備上報的 devInfo.devIP） */
  ip: string | null;
  /** 設備型號 */
  deviceType: string | null;
  online: boolean | null;
  lastSeenAt: string | null;
  role: CameraRole | null;
}

/** ISO 時間 → YYYY/MM/DD HH:mm:ss（本地時間） */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** ISO 時間 → <input type="datetime-local"> 用的 YYYY-MM-DDTHH:mm:ss（本地時間） */
export function toDateTimeLocal(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
