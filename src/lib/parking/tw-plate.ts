// 台灣車牌格式檢查與校正（純規則、本機處理，前後端共用）。
// 攝影機常把外形相近的字元認錯（0/D、8/B、2/Z…），車號不符合台灣車牌格式時，
// 依字元在車牌上的位置（應該是英文或數字）把認錯的字換回來；只有唯一一種合法結果時才修正。

/** L = 英文字母、D = 數字 */
const FORMATS: { pattern: string; label: string }[] = [
  { pattern: "LLLDDDD", label: "汽車新式（ABC-1234）" },
  { pattern: "LLDDDD", label: "汽車舊式（AB-1234）" },
  { pattern: "DDDDLL", label: "汽車舊式（1234-AB）" },
  { pattern: "LLLDDD", label: "機車新式（ABC-123）" },
  { pattern: "DDDLLL", label: "機車舊式（123-ABC）" },
];

// 台灣車牌不使用 I、O（避免和 1、0 混淆）
const isPlateLetter = (c: string) => /^[A-HJ-NP-Z]$/.test(c);
const isDigit = (c: string) => /^\d$/.test(c);

/** 該是英文的位置出現這些字元時，可能是哪些英文被認錯 */
const TO_LETTER: Record<string, string[]> = {
  "0": ["D", "Q"],
  "1": ["T", "L"],
  "2": ["Z"],
  "4": ["A"],
  "5": ["S"],
  "6": ["G"],
  "8": ["B"],
  O: ["D", "Q"],
  I: ["T", "L"],
};

/** 該是數字的位置出現這些字元時，可能是哪個數字被認錯 */
const TO_DIGIT: Record<string, string[]> = {
  O: ["0"],
  D: ["0"],
  Q: ["0"],
  I: ["1"],
  L: ["1"],
  T: ["1"],
  Z: ["2"],
  A: ["4"],
  S: ["5"],
  G: ["6"],
  B: ["8"],
};

const MAX_FIXES = 2;

/** 統一成大寫、去掉空白與連字號等非英數字元 */
export const cleanPlate = (plate: string) => plate.toUpperCase().replace(/[^A-Z0-9]/g, "");

const fits = (plate: string, pattern: string) =>
  plate.length === pattern.length &&
  [...plate].every((c, i) => (pattern[i] === "L" ? isPlateLetter(c) : isDigit(c)));

export interface PlateCheck {
  /** 原始車號（整理過大小寫與符號） */
  original: string;
  /** 校正後的車號；不需要或無法校正時等於 original */
  plate: string;
  /** 校正後是否符合台灣車牌格式 */
  valid: boolean;
  corrected: boolean;
  /** 符合的格式說明 */
  format: string | null;
  /** 修正內容或格式問題的說明 */
  note: string | null;
}

/** 檢查車號是否符合台灣車牌格式，不符合時嘗試依字元位置校正 */
export function checkTaiwanPlate(raw: string): PlateCheck {
  const original = cleanPlate(raw);
  const match = FORMATS.find((f) => fits(original, f.pattern));
  if (match) return { original, plate: original, valid: true, corrected: false, format: match.label, note: null };

  // 每種長度相同的格式，把不合位置的字元換成可能的正確字元，找出換最少字的合法車號
  const candidates = new Map<string, { format: string; fixes: string[] }>();
  for (const { pattern, label } of FORMATS) {
    if (pattern.length !== original.length) continue;
    let partials: { plate: string; fixes: string[] }[] = [{ plate: "", fixes: [] }];
    for (let i = 0; i < original.length; i++) {
      const c = original[i];
      const wantLetter = pattern[i] === "L";
      const ok = wantLetter ? isPlateLetter(c) : isDigit(c);
      const options = ok ? [c] : ((wantLetter ? TO_LETTER : TO_DIGIT)[c] ?? []);
      partials = partials.flatMap((p) =>
        options.map((o) => ({ plate: p.plate + o, fixes: o === c ? p.fixes : [...p.fixes, `${c}→${o}`] })),
      );
      partials = partials.filter((p) => p.fixes.length <= MAX_FIXES);
      if (partials.length === 0) break;
    }
    for (const p of partials) {
      if (p.plate.length === original.length && !candidates.has(p.plate)) {
        candidates.set(p.plate, { format: label, fixes: p.fixes });
      }
    }
  }

  const fewest = Math.min(...[...candidates.values()].map((c) => c.fixes.length));
  const best = [...candidates.entries()].filter(([, c]) => c.fixes.length === fewest);
  if (best.length === 1) {
    const [plate, { format, fixes }] = best[0];
    return {
      original,
      plate,
      valid: true,
      corrected: true,
      format,
      note: `攝影機辨識為 ${original}，依台灣車牌格式修正（${fixes.join("、")}）`,
    };
  }

  const note =
    best.length > 1
      ? `${original} 不符合台灣車牌格式，可能是 ${best.map(([p]) => p).join(" 或 ")}，請人工確認`
      : `${original} 不符合台灣車牌格式，請人工確認`;
  return { original, plate: original, valid: false, corrected: false, format: null, note };
}
