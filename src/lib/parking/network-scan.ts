// 區網設備搜尋（Ping 掃描，server-only，用到 child_process/dns，不可被前端頁面直接引入）
// 掃到 IP 後的帳號密碼登入驗證在 device-login.ts
import { exec } from "node:child_process";
import dns from "node:dns/promises";
import { networkInterfaces } from "node:os";

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function intToIp(n: number): string {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");
}

function maskToCidr(mask: string): number {
  return ipToInt(mask).toString(2).split("1").length - 1;
}

interface LocalSubnet {
  address: string;
  cidr: number;
  networkBase: number;
}

/** 取得本機第一個對外的 IPv4 區網介面（排除 loopback） */
function getLocalSubnet(): LocalSubnet | null {
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const info of list ?? []) {
      if (info.family === "IPv4" && !info.internal) {
        const cidr = maskToCidr(info.netmask);
        const networkBase = ipToInt(info.address) & ipToInt(info.netmask);
        return { address: info.address, cidr, networkBase };
      }
    }
  }
  return null;
}

/** 單一 /24（含）以下網段才整段掃描，避免誤掃到過大的網段 */
const MAX_SCAN_HOSTS = 1024;
const PING_TIMEOUT_MS = 500;
const SCAN_CONCURRENCY = 32;

function pingOnce(ip: string): Promise<boolean> {
  const isWin = process.platform === "win32";
  const cmd = isWin
    ? `ping -n 1 -w ${PING_TIMEOUT_MS} ${ip}`
    : `ping -c 1 -W ${Math.max(1, Math.round(PING_TIMEOUT_MS / 1000))} ${ip}`;
  return new Promise((resolve) => {
    exec(cmd, { timeout: PING_TIMEOUT_MS + 1000 }, (error, stdout) => {
      if (error) return resolve(false);
      const ok = isWin
        ? /TTL=/i.test(stdout)
        : /\d+ (packets )?received/.test(stdout) && !/\b0 (packets )?received/.test(stdout);
      resolve(ok);
    });
  });
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    results[i] = await worker(items[i]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) || 0 }, next));
  return results;
}

export interface ScanResultItem {
  ip: string;
  hostname: string | null;
}

export interface ScanResult {
  subnet: string;
  localAddress: string;
  total: number;
  truncated: boolean;
  items: ScanResultItem[];
  ms: number;
}

/** Ping 掃描本機區網，回傳有回應的 IP（找不到介面或網段過大時丟錯） */
export async function scanLan(): Promise<ScanResult> {
  const subnet = getLocalSubnet();
  if (!subnet) throw new Error("找不到本機區網介面");

  const hostBits = 32 - subnet.cidr;
  const totalHosts = Math.max(0, 2 ** hostBits - 2);
  if (totalHosts === 0) throw new Error("本機網段沒有可掃描的主機位址");

  const start = Date.now();
  const truncated = totalHosts > MAX_SCAN_HOSTS;
  const count = Math.min(totalHosts, MAX_SCAN_HOSTS);

  const ips = Array.from({ length: count }, (_, i) => intToIp(subnet.networkBase + i + 1));
  const alive = await runPool(ips, SCAN_CONCURRENCY, async (ip) => ({ ip, ok: await pingOnce(ip) }));
  const foundIps = alive.filter((a) => a.ok).map((a) => a.ip);

  const items: ScanResultItem[] = await Promise.all(
    foundIps.map(async (ip) => {
      try {
        const names = await dns.reverse(ip);
        return { ip, hostname: names[0] ?? null };
      } catch {
        return { ip, hostname: null };
      }
    }),
  );
  items.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));

  return {
    subnet: `${intToIp(subnet.networkBase)}/${subnet.cidr}`,
    localAddress: subnet.address,
    total: items.length,
    truncated,
    items,
    ms: Date.now() - start,
  };
}

