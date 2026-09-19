import type { TauSuccess } from './decode';

interface Props {
  durations: number[];
  result: TauSuccess;
}

const W = 1000;
const MARGIN_X = 20;
const ROW_INTERVALS_Y = 56;
const ROW_BITS_Y = 132;
const ROW_GROUPS_Y = 190;
const H = 246;

/** 按最小 τ 绘制间隔分类（长型/短型）、成位（短型成对）与 5 位分组 */
export default function PulseDiagram({ durations, result }: Props) {
  const total = durations.reduce((a, b) => a + b, 0);
  const scale = (W - 2 * MARGIN_X) / total;

  // 每个间隔的横向区间（宽度按时长比例）
  const spans: { x: number; w: number; d: number; cls: 'L' | 'S' }[] = [];
  let acc = 0;
  durations.forEach((d, i) => {
    spans.push({ x: MARGIN_X + acc * scale, w: d * scale, d, cls: result.classes[i] });
    acc += d;
  });

  // 每个位覆盖的间隔范围：长型 1 个间隔，短型对 2 个
  const bitSpans = result.members.map((m, bi) => {
    const first = m[0];
    const last = m[m.length - 1];
    return {
      x: spans[first].x,
      w: spans[last].x + spans[last].w - spans[first].x,
      bit: result.bits[bi],
    };
  });

  const groupLabels = result.groups.map((g, i) => {
    if (i === 0) return `${g.value} 起始`;
    if (i === result.groups.length - 1) return `${g.value} LRC`;
    if (i === result.groups.length - 2) return `${g.value} 结束`;
    return `${g.value}`;
  });

  return (
    <svg className="pulse-diagram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="间隔分类与成位图">
      <text x={MARGIN_X} y={20} className="dg-title">
        间隔分类（按 τ = {result.tau}µs；长型→位 0，相邻短型对→位 1）
      </text>

      {/* 间隔条 */}
      {spans.map((s, i) => (
        <g key={`iv-${i}`}>
          <rect x={s.x} y={ROW_INTERVALS_Y} width={Math.max(s.w - 1, 1)} height={34} className={`bar bar-${s.cls}`} />
          {s.w >= 26 && (
            <text x={s.x + s.w / 2} y={ROW_INTERVALS_Y + 21} className="bar-label">
              {s.d}
            </text>
          )}
        </g>
      ))}
      <Legend />

      {/* 成位：长型单间隔或短型对 */}
      {bitSpans.map((b, i) => (
        <g key={`bit-${i}`}>
          <path
            d={`M ${b.x + 2} ${ROW_INTERVALS_Y + 44} q 0 8 8 8 h ${Math.max(b.w - 20, 0)} q 8 0 8 -8`}
            className="bracket"
            fill="none"
          />
          <rect x={b.x + b.w / 2 - 11} y={ROW_BITS_Y} width={22} height={22} rx={4} className={`bit bit-${b.bit}`} />
          <text x={b.x + b.w / 2} y={ROW_BITS_Y + 16} className="bit-label">
            {b.bit}
          </text>
        </g>
      ))}

      {/* 每 5 位一组，标注码值与角色 */}
      {result.groups.map((_, gi) => {
        const startBit = gi * 5;
        const endBit = startBit + 4;
        const x0 = bitSpans[startBit].x - 4;
        const x1 = bitSpans[endBit].x + bitSpans[endBit].w + 4;
        const role =
          gi === 0
            ? 'grp-start'
            : gi === result.groups.length - 1
              ? 'grp-lrc'
              : gi === result.groups.length - 2
                ? 'grp-end'
                : 'grp-data';
        return (
          <g key={`grp-${gi}`}>
            <rect x={x0} y={ROW_GROUPS_Y} width={x1 - x0} height={40} rx={6} className={`grp ${role}`} />
            <text x={(x0 + x1) / 2} y={ROW_GROUPS_Y + 25} className="grp-label">
              {groupLabels[gi]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Legend() {
  return (
    <g transform={`translate(${W - 250}, 12)`}>
      <rect x={0} y={0} width={14} height={14} className="bar bar-L" />
      <text x={20} y={11} className="legend-text">长型 (位 0)</text>
      <rect x={100} y={0} width={14} height={14} className="bar bar-S" />
      <text x={120} y={11} className="legend-text">短型对 (位 1)</text>
    </g>
  );
}
