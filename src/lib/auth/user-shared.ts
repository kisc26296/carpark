// 使用者與登入的共用定義（前後端都可以 import）

/** 登入狀態保留 180 分鐘（從登入起算） */
export const SESSION_MAX_AGE_SEC = 180 * 60;
export const SESSION_COOKIE = "carpark_session";

/** 可以授權的功能，對應首頁左側選單；管理者（admin）一律全部都有，也只有管理者能進使用者設定 */
export const PERMISSIONS = [
  { id: "database", label: "資料庫設定" },
  { id: "rate", label: "費率設定" },
  { id: "device", label: "設備設定" },
  { id: "entry", label: "車輛進場紀錄" },
  { id: "shift", label: "交班" },
  { id: "report", label: "報表" },
  { id: "monthly", label: "月租設定" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["id"];
export type UserRole = "admin" | "user";

export const ROLE_LABELS: Record<UserRole, string> = { admin: "管理者", user: "一般使用者" };

export interface PublicUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  /** 一般使用者可用的功能；管理者固定為全部 */
  permissions: Permission[];
  createdAt: string | null;
  updatedAt: string | null;
}

/** 只限管理者的功能：使用者設定、電子發票測試 */
export type AdminOnly = "users" | "einvoice";

/** 使用者是否可以使用某個功能（AdminOnly 的功能只限管理者） */
export function hasPermission(user: Pick<PublicUser, "role" | "permissions">, key: Permission | AdminOnly): boolean {
  if (user.role === "admin") return true;
  return key !== "users" && key !== "einvoice" && user.permissions.includes(key);
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_.@-]{3,32}$/;
export const PASSWORD_MIN_LENGTH = 4;
