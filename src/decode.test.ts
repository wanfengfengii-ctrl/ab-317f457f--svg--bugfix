import { describe, it, expect } from 'vitest';
import {
  classifyInterval,
  decodeWithTau,
  decodePulses,
  summarizeSuccesses,
  validateInput,
  type TauSuccess,
} from './decode';
import { encodeDigits, codeToBits, bitsToDurations } from './encode';

describe('classifyInterval', () => {
  it('长型与短型基本判定', () => {
    expect(classifyInterval(100, 100)).toBe('L');
    expect(classifyInterval(50, 100)).toBe('S');
    expect(classifyInterval(20, 100)).toBe('none');
  });

  it('公差 ±6 边界包含', () => {
    expect(classifyInterval(106, 100)).toBe('L');
    expect(classifyInterval(94, 100)).toBe('L');
    expect(classifyInterval(53, 100)).toBe('S'); // |2*53-100|=6
    expect(classifyInterval(47, 100)).toBe('S'); // |94-100|=6
  });

  it('在 τ∈80..120 范围内长/短区间不相交（不存在兼属）', () => {
    for (let tau = 80; tau <= 120; tau++) {
      for (let d = 20; d <= 150; d++) {
        expect(classifyInterval(d, tau)).not.toBe('both');
      }
    }
  });
});

describe('decodeWithTau / decodePulses 往返', () => {
  it('数字串 123 在 τ=100 编码后可解，且 τ=94..106 全部有效', () => {
    const durations = encodeDigits('123', 100);
    const result = decodePulses(durations);
    expect(result.status).toBe('decoded');
    if (result.status !== 'decoded') return;
    expect(result.digits).toBe('123');
    expect(result.taus).toEqual(Array.from({ length: 13 }, (_, i) => 94 + i));
    expect(result.min.tau).toBe(94);
  });

  it('按最小 τ 得到的分类：长型为 0、相邻短型对为 1', () => {
    const durations = encodeDigits('7', 100);
    const result = decodePulses(durations);
    if (result.status !== 'decoded') throw new Error('应 decoded');
    const { classes, members, bits } = result.min;
    expect(classes.length).toBe(durations.length);
    members.forEach((m, bi) => {
      if (bits[bi] === 0) {
        expect(m).toHaveLength(1);
        expect(classes[m[0]]).toBe('L');
      } else {
        expect(m).toHaveLength(2);
        expect(classes[m[0]]).toBe('S');
        expect(classes[m[1]]).toBe('S');
      }
    });
  });

  it('1 位与 12 位载荷均可解，13 位不可解', () => {
    expect(decodePulses(encodeDigits('0', 100)).status).toBe('decoded');
    expect(decodePulses(encodeDigits('012345678901', 100)).status).toBe('decoded');
    expect(decodePulses(encodeDigits('0123456789012', 100)).status).toBe('unreadable');
  });

  it('漂移时钟：τ=82 编码的数据仅在邻近 τ 窗口有效', () => {
    const durations = encodeDigits('909', 82);
    const result = decodePulses(durations);
    expect(result.status).toBe('decoded');
    if (result.status !== 'decoded') return;
    expect(result.min.tau).toBe(80);
    expect(result.taus).toEqual([80, 81, 82, 83, 84, 85, 86, 87, 88]);
    expect(result.digits).toBe('909');
  });
});

describe('逐 τ 淘汰原因', () => {
  it('孤立短型淘汰该 τ', () => {
    const durations = [...encodeDigits('1', 100), 50];
    for (let tau = 94; tau <= 106; tau++) {
      const r = decodeWithTau(tau, durations);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('孤立短型');
    }
    expect(decodePulses(durations).status).toBe('unreadable');
  });

  it('无法分类的间隔淘汰该 τ', () => {
    const durations = [...encodeDigits('1', 100), 20];
    expect(decodeWithTau(100, durations)).toMatchObject({ ok: false });
    expect(decodePulses(durations).status).toBe('unreadable');
  });

  it('帧外残余位淘汰', () => {
    const durations = [...encodeDigits('1', 100), 100]; // 多一个 0 位
    const r = decodeWithTau(100, durations);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('帧外');
  });

  it('载荷码超出 0..9 时整帧拒绝', () => {
    const codes = [11, 10, 15];
    let lrc = 0;
    codes.forEach((c) => (lrc ^= c));
    const durations = bitsToDurations([...codes, lrc].flatMap(codeToBits), 100);
    expect(decodePulses(durations).status).toBe('unreadable');
  });

  it('LRC 码值允许超过 9（仅载荷限 0..9）：构造 LRC=12 的合法帧', () => {
    // 11 ^ payload ^ 15 = 12  => payload = 11 ^ 15 ^ 12 = 10? 求 payload∈0..9：
    // 枚举 payload 0..9 找一个 XOR>9 的
    let found: { p: number; lrc: number } | null = null;
    for (let p = 0; p <= 9; p++) {
      const lrc = 11 ^ p ^ 15;
      if (lrc > 9) { found = { p, lrc }; break; }
    }
    expect(found).not.toBeNull();
    const { p, lrc } = found!;
    const durations = bitsToDurations([11, p, 15, lrc].flatMap(codeToBits), 100);
    const result = decodePulses(durations);
    expect(result.status).toBe('decoded');
    if (result.status === 'decoded') expect(result.digits).toBe(String(p));
  });

  it('τ=80 边界：40 的短型在 τ=80 有效，窗口仅 80..86', () => {
    const durations = encodeDigits('3', 80).map((d) => (d === 40 ? 40 : d));
    const result = decodePulses(durations);
    expect(result.status).toBe('decoded');
    if (result.status === 'decoded') {
      expect(result.taus[0]).toBe(80);
      expect(result.taus[result.taus.length - 1]).toBeLessThanOrEqual(86);
    }
  });

  it('LRC 错误时整帧拒绝', () => {
    const codes = [11, 5, 15, 0]; // 正确 LRC 应为 11^5^15=1
    const durations = bitsToDurations(codes.flatMap(codeToBits), 100);
    expect(decodePulses(durations).status).toBe('unreadable');
  });
});

describe('validateInput 稳定汇总错误', () => {
  it('合法输入返回整数数组', () => {
    const r = validateInput('[100, 50, 50, 100, 100, 100]');
    expect(r.errors).toEqual([]);
    expect(r.pulses).toEqual([100, 50, 50, 100, 100, 100]);
  });

  it('JSON 语法错误为整份级错误并拒绝', () => {
    const r = validateInput('not json');
    expect(r.pulses).toBeNull();
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].pos).toBe(-1);
  });

  it('非数组整份拒绝', () => {
    expect(validateInput('{"a":1}').errors[0].pos).toBe(-1);
    expect(validateInput('"123"').pulses).toBeNull();
  });

  it('按位置稳定汇总：长度错误在前，随后下标升序', () => {
    const input = '[151, "x", 100, 3.5]';
    const a = validateInput(input);
    const b = validateInput(input);
    expect(a.pulses).toBeNull();
    expect(a.errors).toEqual(b.errors); // 稳定
    expect(a.errors.map((e) => e.pos)).toEqual([-1, 0, 1, 3]);
    expect(a.errors[0].message).toContain('长度必须为 6..200');
  });

  it('长度越界（201 个）整份拒绝', () => {
    const arr = Array.from({ length: 201 }, () => 100);
    const r = validateInput(JSON.stringify(arr));
    expect(r.pulses).toBeNull();
    expect(r.errors.some((e) => e.pos === -1 && /201/.test(e.message))).toBe(true);
  });
});

describe('summarizeSuccesses 汇总与歧义排序', () => {
  function fakeSuccess(tau: number, digits: string): TauSuccess {
    return {
      tau,
      ok: true,
      classes: [],
      bits: [],
      members: [],
      groups: [],
      codes: [],
      digits,
    } as TauSuccess;
  }

  it('空列表 -> unreadable', () => {
    expect(summarizeSuccesses([])).toEqual({ status: 'unreadable' });
  });

  it('同一数字串多个 τ -> decoded，取最小 τ', () => {
    const s = summarizeSuccesses([fakeSuccess(100, '1'), fakeSuccess(94, '1'), fakeSuccess(106, '1')]);
    expect(s.status).toBe('decoded');
    if (s.status === 'decoded') {
      expect(s.digits).toBe('1');
      expect(s.taus).toEqual([94, 100, 106]);
      expect(s.min.tau).toBe(94);
    }
  });

  it('不同数字串 -> ambiguous，按字典序排列并附 τ', () => {
    const s = summarizeSuccesses([
      fakeSuccess(120, '9'),
      fakeSuccess(100, '10'),
      fakeSuccess(101, '10'),
      fakeSuccess(80, '0'),
    ]);
    expect(s.status).toBe('ambiguous');
    if (s.status === 'ambiguous') {
      expect(s.entries.map((e) => e.digits)).toEqual(['0', '10', '9']);
      expect(s.entries[1].taus).toEqual([100, 101]);
    }
  });
});
