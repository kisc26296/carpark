import "server-only";
import type { Db } from "mongodb";
import { getParkingDb } from "@/lib/parking/store";
import {
  CASH_DEVICES,
  DEFAULT_BILL_SETTINGS,
  DEFAULT_COIN_SETTINGS,
  DEFAULT_HOPPER_SETTINGS,
  DEFAULT_SERIAL_SETTINGS,
  type BillSettings,
  type CashDeviceConfig,
  type CashDeviceId,
  type CoinSettings,
  type HopperDeviceId,
  type HopperSettings,
} from "./shared";

const COLLECTION = "cash_device_config";

// 各設備協定自己的設定（紙鈔機面額、出幣機位址、硬幣通道…）存在該設備那筆設定的 <device>Settings 欄位
const settingsField = (device: string) => `${device}Settings`;

const defaultConfig = (device: CashDeviceId): CashDeviceConfig => ({
  device,
  ...DEFAULT_SERIAL_SETTINGS[device],
  autoConnect: false,
  updatedAt: null,
});

const globalForConfig = globalThis as typeof globalThis & {
  _cashConfigMigrated?: Promise<void>;
};

/**
 * 早期版本只有一台找零錢機（device: "hopper"），改成 4 台後把它搬到 1 元那台（hopper1），
 * 連同協定設定欄位 hopperSettings → hopper1Settings。只在 hopper1 還沒有設定時搬，搬過一次就不會再動。
 */
async function migrateLegacyHopper(db: Db): Promise<void> {
  const col = db.collection(COLLECTION);
  const legacy = await col.findOne({ device: "hopper" });
  if (!legacy) return;
  if (!(await col.findOne({ device: "hopper1" }))) {
    const { _id, hopperSettings, ...rest } = legacy;
    await col.insertOne({ ...rest, device: "hopper1", ...(hopperSettings ? { hopper1Settings: hopperSettings } : {}) });
    void _id;
  }
  await col.deleteOne({ device: "hopper" });
}

async function getDb(): Promise<Db> {
  const db = await getParkingDb();
  if (!globalForConfig._cashConfigMigrated) {
    const migrating = migrateLegacyHopper(db);
    migrating.catch(() => {
      globalForConfig._cashConfigMigrated = undefined;
    });
    globalForConfig._cashConfigMigrated = migrating;
  }
  await globalForConfig._cashConfigMigrated;
  return db;
}

/** 讀取所有設備的設定，資料庫沒有的設備補上預設值 */
export async function getAllConfigs(): Promise<CashDeviceConfig[]> {
  const db = await getDb();
  const docs = await db
    .collection<CashDeviceConfig>(COLLECTION)
    .find({}, { projection: { _id: 0, ...Object.fromEntries(CASH_DEVICES.map((d) => [settingsField(d), 0])) } })
    .toArray();
  return CASH_DEVICES.map((device) => ({ ...defaultConfig(device), ...docs.find((d) => d.device === device) }));
}

export async function getConfig(device: CashDeviceId): Promise<CashDeviceConfig> {
  const configs = await getAllConfigs();
  return configs.find((c) => c.device === device)!;
}

export async function saveConfig(
  device: CashDeviceId,
  patch: Partial<Omit<CashDeviceConfig, "device" | "updatedAt">>,
): Promise<CashDeviceConfig> {
  const db = await getDb();
  await db
    .collection<CashDeviceConfig>(COLLECTION)
    .updateOne({ device }, { $set: { ...patch, device, updatedAt: new Date().toISOString() } }, { upsert: true });
  return getConfig(device);
}

async function getProtocolSettings<T extends object>(device: CashDeviceId, defaults: T): Promise<T> {
  const db = await getDb();
  const field = settingsField(device);
  const doc = await db.collection(COLLECTION).findOne({ device }, { projection: { _id: 0, [field]: 1 } });
  return { ...defaults, ...(doc?.[field] as Partial<T> | undefined) };
}

async function saveProtocolSettings(device: CashDeviceId, settings: object): Promise<void> {
  const db = await getDb();
  await db.collection(COLLECTION).updateOne({ device }, { $set: { [settingsField(device)]: settings } }, { upsert: true });
}

export const getBillSettings = () => getProtocolSettings<BillSettings>("bill", DEFAULT_BILL_SETTINGS);
export const saveBillSettings = (settings: BillSettings) => saveProtocolSettings("bill", settings);
export const getHopperSettings = (device: HopperDeviceId) =>
  getProtocolSettings<HopperSettings>(device, DEFAULT_HOPPER_SETTINGS);
export const saveHopperSettings = (device: HopperDeviceId, settings: HopperSettings) =>
  saveProtocolSettings(device, settings);
export const getCoinSettings = () => getProtocolSettings<CoinSettings>("coin", DEFAULT_COIN_SETTINGS);
export const saveCoinSettings = (settings: CoinSettings) => saveProtocolSettings("coin", settings);
