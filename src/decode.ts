/**
 * 磁标脉冲串解码核心（纯函数，无 DOM 依赖，可在 Node/浏览器运行）
 *
 * 规则：
 *  - 枚举整数时钟 τ = 80..120
 *  - 每个间隔 d：长型 |d-τ|≤6（成位 0），短型 |2d-τ|≤6；两者兼属或皆不属则该 τ 淘汰
 *  - 相邻两个短型成位 1；短型必须两两成对，出现孤立短型（奇数连串）淘汰该 τ
 *  - 位流每 5 位一组：前 4 位低位在前组成码值，第 5 位奇校验（本组 1 总数为奇数）
 *  - 帧 = 起始码 11 + 1..12 个载荷码(0..9) + 结束码 15 + LRC
 *  - LRC 前四位 = 此前所有码值逐位异或；帧外不得有位
 */

export const TAU_MIN = 80;
export const TAU_MAX = 120;
export const TAU_TOLERANCE = 6;

export const START_CODE = 11;
export const END_CODE = 15;
export const MIN_PAYLOADS = 1;
export const MAX_PAYLOADS = 12;

export type IntervalClass = 'L' | 'S';

export interface InputError {
  /** 从 0 开始的数组下标；-1 表示整份输入级别的错误 */
  pos: number;
  message: string;
}

export type ClassKind = IntervalClass | 'none' | 'both';

export function classifyInterval(d: number, tau: number): ClassKind {
  const isLong = Math.abs(d - tau) <= TAU_TOLERANCE;
  const isShort = Math.abs(2 * d - tau) <= TAU_TOLERANCE;
  if (isLong && isShort) return 'both';
  if (isLong) return 'L';
  if (isShort) return 'S';
  return 'none';
}

export interface BitGroup {
  value: number;
  parityBit: number;
  parityOk: boolean;
  bits: number[];
}

export interface TauFailure {
  tau: number;
  ok: false;
  reason: string;
}

export interface TauSuccess {
  tau: number;
  ok: true;
  /** 每个间隔的分类（长度 = 间隔数） */
  classes: IntervalClass[];
  /** 成位后的位流 */
  bits: number[];
  /** 每个位由哪些间隔下标组成：长型 1 个，短型对 2 个 */
  members: number[][];
  groups: BitGroup[];
  codes: number[];
  digits: string;
}

export type TauResult = TauFailure | TauSuccess;

/**
 * 在给定 τ 下完成“分类 → 成位 → 分组 → 帧校验”的完整解码
 * @param durations 间隔时长数组（每个元素即一个 d，单位微秒）
 */
export function decodeWithTau(tau: number, durations: number[]): TauResult {
  const classes: IntervalClass[] = [];
  for (let i = 0; i < durations.length; i++) {
    const kind = classifyInterval(durations[i], tau);
    if (kind === 'none') return { tau, ok: false, reason: `间隔 ${i + 1} 既非长型也非短型` };
    if (kind === 'both') return { tau, ok: false, reason: `间隔 ${i + 1} 同时兼属长型与短型` };
    classes.push(kind);
  }

  // 成位：长型 -> 0；相邻短型两两 -> 1；奇数连短型 => 孤立短型
  const bits: number[] = [];
  const members: number[][] = [];
  for (let i = 0; i < classes.length; ) {
    if (classes[i] === 'L') {
      bits.push(0);
      members.push([i]);
      i++;
    } else {
      if (classes[i + 1] !== 'S') {
        return { tau, ok: false, reason: `间隔 ${i + 1} 是孤立短型` };
      }
      bits.push(1);
      members.push([i, i + 1]);
      i += 2;
    }
  }

  if (bits.length === 0) return { tau, ok: false, reason: '位流为空' };
  if (bits.length % 5 !== 0) {
    return { tau, ok: false, reason: `位流长度 ${bits.length} 不是 5 的整数倍，帧外存在残余位` };
  }

  const groups: BitGroup[] = [];
  for (let g = 0; g < bits.length; g += 5) {
    const slice = bits.slice(g, g + 5);
    const value = slice[0] | (slice[1] << 1) | (slice[2] << 2) | (slice[3] << 3);
    const parityBit = slice[4];
    const ones = slice.reduce((a, b) => a + b, 0);
    groups.push({ value, parityBit, parityOk: ones % 2 === 1, bits: slice });
  }

  const badParity = groups.findIndex((g) => !g.parityOk);
  if (badParity >= 0) {
    return { tau, ok: false, reason: `第 ${badParity + 1} 组奇校验失败` };
  }

  const codeCount = groups.length;
  const payloadCount = codeCount - 3;
  if (payloadCount < MIN_PAYLOADS || payloadCount > MAX_PAYLOADS) {
    return { tau, ok: false, reason: `载荷码数量 ${payloadCount} 不在 1..12 内` };
  }

  const codes = groups.map((g) => g.value);
  if (codes[0] !== START_CODE) return { tau, ok: false, reason: `起始码应为 ${START_CODE}，实际 ${codes[0]}` };
  if (codes[codeCount - 2] !== END_CODE) {
    return { tau, ok: false, reason: `结束码应为 ${END_CODE}，实际 ${codes[codeCount - 2]}` };
  }
  for (let p = 0; p < payloadCount; p++) {
    const v = codes[1 + p];
    if (v < 0 || v > 9) return { tau, ok: false, reason: `载荷码 ${p + 1} = ${v} 超出 0..9` };
  }
  let lrc = 0;
  for (let i = 0; i < codeCount - 1; i++) lrc ^= codes[i];
  if (codes[codeCount - 1] !== lrc) {
    return { tau, ok: false, reason: `LRC 应为 ${lrc}，实际 ${codes[codeCount - 1]}` };
  }

  return {
    tau,
    ok: true,
    classes,
    bits,
    members,
    groups,
    codes,
    digits: codes.slice(1, 1 + payloadCount).join(''),
  };
}

export type OverallStatus = 'unreadable' | 'decoded' | 'ambiguous';

export interface DecodedOutcome {
  status: 'decoded';
  digits: string;
  /** 解出同一数字串的全部 τ，升序 */
  taus: number[];
  /** 按最小 τ 得到的完整解码，用于绘制分类与成位 */
  min: TauSuccess;
}

export interface AmbiguousOutcome {
  status: 'ambiguous';
  /** 数字串字典序升序；每项给出产生该串的 τ（升序） */
  entries: { digits: string; taus: number[] }[];
}

export interface UnreadableOutcome {
  status: 'unreadable';
}

export type Overall = DecodedOutcome | AmbiguousOutcome | UnreadableOutcome;

/** 把各 τ 的成功结果按“数字串是否唯一”汇总 */
export function summarizeSuccesses(successes: TauSuccess[]): Overall {
  const byDigits = new Map<string, TauSuccess[]>();
  for (const s of successes) {
    const list = byDigits.get(s.digits);
    if (list) list.push(s);
    else byDigits.set(s.digits, [s]);
  }

  if (byDigits.size === 0) return { status: 'unreadable' };
  if (byDigits.size === 1) {
    const [digits, list] = [...byDigits.entries()][0];
    const sorted = [...list].sort((a, b) => a.tau - b.tau);
    return { status: 'decoded', digits, taus: sorted.map((s) => s.tau), min: sorted[0] };
  }

  const entries = [...byDigits.entries()]
    .map(([digits, list]) => ({ digits, taus: list.map((s) => s.tau).sort((a, b) => a - b) }))
    .sort((a, b) => (a.digits < b.digits ? -1 : a.digits > b.digits ? 1 : 0));
  return { status: 'ambiguous', entries };
}

/** 枚举全部 τ 并按“数字串是否唯一”汇总 */
export function decodePulses(durations: number[]): Overall {
  const successes: TauSuccess[] = [];
  for (let tau = TAU_MIN; tau <= TAU_MAX; tau++) {
    const r = decodeWithTau(tau, durations);
    if (r.ok) successes.push(r);
  }
  return summarizeSuccesses(successes);
}

/* ----------------------------- 输入校验 ----------------------------- */

export const MIN_PULSES = 6;
export const MAX_PULSES = 200;
export const MIN_DURATION = 20;
export const MAX_DURATION = 150;

/**
 * 解析并校验文本输入，错误按位置稳定汇总（整份级在前，随后按下标升序）。
 * 校验不通过时 pulses 为 null，调用方必须据此清除旧结果。
 */
export function validateInput(text: string): { pulses: number[] | null; errors: InputError[] } {
  const errors: InputError[] = [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { pulses: null, errors: [{ pos: -1, message: `JSON 解析失败：${(e as Error).message}` }] };
  }

  if (!Array.isArray(value)) {
    return { pulses: null, errors: [{ pos: -1, message: '输入必须是 JSON 数组，例如 [100, 50, 50, 100]' }] };
  }

  const arr = value as unknown[];
  if (arr.length < MIN_PULSES || arr.length > MAX_PULSES) {
    errors.push({
      pos: -1,
      message: `数组长度必须为 ${MIN_PULSES}..${MAX_PULSES}，当前为 ${arr.length}`,
    });
  }

  arr.forEach((item, i) => {
    if (typeof item !== 'number' || !Number.isInteger(item)) {
      errors.push({ pos: i, message: `第 ${i + 1} 项必须是整数，当前为 ${JSON.stringify(item)}` });
      return;
    }
    if (item < MIN_DURATION || item > MAX_DURATION) {
      errors.push({ pos: i, message: `第 ${i + 1} 项必须在 ${MIN_DURATION}..${MAX_DURATION} 微秒内，当前为 ${item}` });
    }
  });

  if (errors.length > 0) {
    errors.sort((a, b) => a.pos - b.pos || (a.message < b.message ? -1 : 1));
    return { pulses: null, errors };
  }
  return { pulses: arr as number[], errors: [] };
}
