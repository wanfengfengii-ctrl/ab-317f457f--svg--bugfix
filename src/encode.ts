/**
 * 编码器：把数字串按协议反向生成间隔时长数组。
 * 主要用于单元/E2E 测试构造已知良好输入，也为 UI 提供示例数据。
 */
import { START_CODE, END_CODE } from './decode';

/** 码值 -> 5 位：前 4 位低位在前，第 5 位奇校验 */
export function codeToBits(code: number): number[] {
  const bits = [code & 1, (code >> 1) & 1, (code >> 2) & 1, (code >> 3) & 1];
  const ones = bits.reduce((a, b) => a + b, 0);
  bits.push(ones % 2 === 0 ? 1 : 0);
  return bits;
}

/** 位流 -> 间隔时长：0 位一个长型 τ；1 位两个短型 τ/2 */
export function bitsToDurations(bits: number[], tau = 100): number[] {
  const out: number[] = [];
  for (const b of bits) {
    if (b === 0) out.push(tau);
    else out.push(tau / 2, tau / 2);
  }
  return out;
}

/** 数字串 -> 完整帧（起始码 + 载荷 + 结束码 + LRC）的间隔时长数组 */
export function encodeDigits(digits: string, tau = 100): number[] {
  if (!/^[0-9]+$/.test(digits)) throw new Error('digits 必须为 0..9 的数字串');
  const codes = [START_CODE, ...[...digits].map((ch) => Number(ch)), END_CODE];
  let lrc = 0;
  for (const c of codes) lrc ^= c;
  codes.push(lrc);
  const bits = codes.flatMap(codeToBits);
  return bitsToDurations(bits, tau).map((d) => Math.round(d));
}
