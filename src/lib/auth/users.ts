import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { COLLECTIONS, getParkingDb } from "@/lib/parking/store";
import { verifySessionToken } from "./session";
import {
  PASSWORD_MIN_LENGTH,
  PERMISSIONS,
  SESSION_COOKIE,
  USERNAME_PATTERN,
  type Permission,
  type PublicUser,
  type UserRole,
} from "./user-shared";

// 使用者帳號（carpark.user）：密碼以 scrypt 加鹽雜湊後儲存。
// 集合裡還沒有任何可登入的使用者時，自動建立預設管理者 admin / admin。
// user 集合裡原本就有的其他資料（沒有帳號密碼的文件）不會被讀取、修改或刪除。

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

interface UserDoc {
  _id: ObjectId;
  username: string;
  name: string;
  role: UserRole;
  permissions: Permission[];
  /** scrypt$<salt hex>$<hash hex> */
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export class UserError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** 只處理有帳號密碼的文件 */
const LOGIN_USER = { username: { $type: "string" }, passwordHash: { $type: "string" } } as const;

const globalForUsers = globalThis as typeof globalThis & { _defaultAdminReady?: Promise<void> };

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

async function collection() {
  const users = (await getParkingDb()).collection<UserDoc>(COLLECTIONS.users);
  // 第一次使用時建立預設管理者（只在完全沒有使用者時）
  if (!globalForUsers._defaultAdminReady) {
    const ready = (async () => {
      if ((await users.countDocuments(LOGIN_USER, { limit: 1 })) > 0) return;
      const now = new Date();
      await users
        .insertOne({
          _id: new ObjectId(),
          username: "admin",
          name: "管理者",
          role: "admin",
          permissions: PERMISSIONS.map((p) => p.id),
          passwordHash: await hashPassword("admin"),
          createdAt: now,
          updatedAt: now,
        })
        .catch((error: { code?: number }) => {
          // 另一個請求同時建立了 admin（帳號有唯一索引），忽略即可
          if (error.code !== 11000) throw error;
        });
    })();
    ready.catch(() => {
      globalForUsers._defaultAdminReady = undefined;
    });
    globalForUsers._defaultAdminReady = ready;
  }
  await globalForUsers._defaultAdminReady;
  return users;
}

function toPublic(doc: UserDoc): PublicUser {
  return {
    id: doc._id.toHexString(),
    username: doc.username,
    name: doc.name,
    role: doc.role,
    permissions: doc.role === "admin" ? PERMISSIONS.map((p) => p.id) : doc.permissions,
    createdAt: doc.createdAt?.toISOString() ?? null,
    updatedAt: doc.updatedAt?.toISOString() ?? null,
  };
}

function parseId(id: unknown): ObjectId {
  if (typeof id !== "string" || !ObjectId.isValid(id)) throw new UserError("使用者 id 不正確", 400);
  return new ObjectId(id);
}

/** 帳號密碼正確時回傳使用者，否則 null */
export async function verifyLogin(username: string, password: string): Promise<PublicUser | null> {
  const users = await collection();
  const doc = await users.findOne({ ...LOGIN_USER, username: username.trim() });
  if (!doc || !(await checkPassword(password, doc.passwordHash))) return null;
  return toPublic(doc);
}

/** 依 cookie 取得目前登入的使用者（session 失效或帳號已刪除時回傳 null） */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const session = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || !ObjectId.isValid(session.sub)) return null;
  const doc = await (await collection()).findOne({ ...LOGIN_USER, _id: new ObjectId(session.sub) });
  return doc ? toPublic(doc) : null;
}

/** 只有管理者能管理使用者；回傳目前的管理者 */
export async function requireAdmin(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new UserError("請先登入", 401);
  if (user.role !== "admin") throw new UserError("只有管理者可以管理使用者", 403);
  return user;
}

export async function listUsers(): Promise<PublicUser[]> {
  const docs = await (await collection()).find(LOGIN_USER).sort({ createdAt: 1 }).toArray();
  return docs.map(toPublic);
}

export interface UserInput {
  username?: unknown;
  name?: unknown;
  password?: unknown;
  role?: unknown;
  permissions?: unknown;
}

function parseFields(input: UserInput, passwordRequired: boolean) {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  if (!USERNAME_PATTERN.test(username)) {
    throw new UserError("帳號須為 3～32 個英文字母、數字或 _ . @ -", 400);
  }
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 40) : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (password || passwordRequired) {
    if (password.length < PASSWORD_MIN_LENGTH) throw new UserError(`密碼至少 ${PASSWORD_MIN_LENGTH} 個字元`, 400);
    if (password.length > 128) throw new UserError("密碼太長", 400);
  }
  if (input.role !== "admin" && input.role !== "user") throw new UserError("權限角色不正確", 400);
  const requested = Array.isArray(input.permissions) ? input.permissions : [];
  // 依選單順序排列，並丟掉不認得的功能
  const permissions = PERMISSIONS.map((p) => p.id).filter((id) => requested.includes(id));
  return { username, name, password, role: input.role as UserRole, permissions };
}

function duplicateUsername(error: unknown): never {
  if ((error as { code?: number }).code === 11000) throw new UserError("帳號已經有人使用", 409);
  throw error;
}

export async function createUser(input: UserInput): Promise<PublicUser> {
  const fields = parseFields(input, true);
  const now = new Date();
  const doc: UserDoc = {
    _id: new ObjectId(),
    username: fields.username,
    name: fields.name,
    role: fields.role,
    permissions: fields.permissions,
    passwordHash: await hashPassword(fields.password),
    createdAt: now,
    updatedAt: now,
  };
  await (await collection()).insertOne(doc).catch(duplicateUsername);
  return toPublic(doc);
}

/** 系統至少要留一個管理者 */
async function ensureAnotherAdmin(excludeId: ObjectId, message: string): Promise<void> {
  const users = await collection();
  if ((await users.countDocuments({ ...LOGIN_USER, role: "admin", _id: { $ne: excludeId } }, { limit: 1 })) === 0) {
    throw new UserError(message, 400);
  }
}

/** 修改使用者；密碼留空表示不修改 */
export async function updateUser(id: unknown, input: UserInput): Promise<PublicUser> {
  const _id = parseId(id);
  const fields = parseFields(input, false);
  const users = await collection();
  const existing = await users.findOne({ ...LOGIN_USER, _id });
  if (!existing) throw new UserError("找不到這個使用者", 404);
  if (existing.role === "admin" && fields.role !== "admin") {
    await ensureAnotherAdmin(_id, "至少要保留一個管理者，無法把最後一個管理者改成一般使用者");
  }
  const set: Partial<UserDoc> = {
    username: fields.username,
    name: fields.name,
    role: fields.role,
    permissions: fields.permissions,
    updatedAt: new Date(),
  };
  if (fields.password) set.passwordHash = await hashPassword(fields.password);
  const updated = await users
    .findOneAndUpdate({ ...LOGIN_USER, _id }, { $set: set }, { returnDocument: "after" })
    .catch(duplicateUsername);
  if (!updated) throw new UserError("找不到這個使用者", 404);
  return toPublic(updated);
}

export async function deleteUser(id: unknown, currentUserId: string): Promise<void> {
  const _id = parseId(id);
  if (_id.toHexString() === currentUserId) throw new UserError("不能刪除自己目前登入的帳號", 400);
  const users = await collection();
  const existing = await users.findOne({ ...LOGIN_USER, _id });
  if (!existing) throw new UserError("找不到這個使用者", 404);
  if (existing.role === "admin") await ensureAnotherAdmin(_id, "至少要保留一個管理者");
  await users.deleteOne({ ...LOGIN_USER, _id });
}
