import type { TauSuccess } from './decode';

interface Props {
  durations: number[];
  result: TauSuccess;
}

/** 视口充裕时的基准画布宽；内容需要更宽时按最小比例放大，不会压缩回此宽度 */
const BASE_W = 1000;
const MARGIN_X = 20;
const ROW_INTERVALS_Y = 56;
const ROW_BITS_Y = 132;
const ROW_GROUPS_Y = 190;
const H = 246;

/** 固定尺寸位标记宽（与下方 rect width 保持一致） */
const BIT_BOX_W = 22;
/** 相邻位中心的最小间距：22 位框 + 两侧各 2 单位净距，保证框与 0/1 标签互不相碰 */
const MIN_BIT_CENTER_GAP = BIT_BOX_W + 4;
/** 单个位跨（长型 1 间隔 / 短型对 2 间隔）的最小绘制宽，保证配对括号可辨 */
const MIN_BIT_SPAN_W = 24;
/** 5 位分组覆盖层的最小绘制宽，保证组标签不越界、相邻组不重叠 */
const MIN_GROUP_W = 110;

/** 按最小 τ 绘制间隔分类（长型/短型）、成位（短型成对）与 5 位分组 */
export default function PulseDiagram({ durations, result }: Props) {
  const total = durations.reduce((a, b) => a + b, 0);

  // 每个位实际占用的时长（长型=1 个间隔；短型对=2 个间隔之和）
  const bitDurations = result.members.map((m) => m.reduce((a, idx) => a + durations[idx], 0));

  // 相邻位中心的时间间距 = 两个位跨时长之和的一半
  let minGapUs = Infinity;
  for (let i = 1; i < bitDurations.length; i++) {
    minGapUs = Math.min(minGapUs, (bitDurations[i - 1] + bitDurations[i]) / 2);
  }
  let minGroupUs = Infinity;
  for (let g = 0; g < result.groups.length; g++) {
    const span = bitDurations.slice(g * 5, g * 5 + 5).reduce((a, b) => a + b, 0);
    minGroupUs = Math.min(minGroupUs, span);
  }

  // 比例绘制但设下限：位框、括号、分组覆盖层在最大合法帧中也不得相碰
  const fitScale = (BASE_W - 2 * MARGIN_X) / total;
  const minScale = Math.max(
    MIN_BIT_CENTER_GAP / minGapUs,
    MIN_BIT_SPAN_W / Math.min(...bitDurations),
    MIN_GROUP_W / minGroupUs,
  );
  const scale = Math.max(fitScale, minScale);
  const W = Math.max(BASE_W, Math.ceil(2 * MARGIN_X + total * scale));

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
    <div className="diagram-scroll" data-testid="diagram-scroll">
      <svg
        className="pulse-diagram"
        viewBox={`0 0 ${W} ${H}`}
        style={{ minWidth: W }}
        role="img"
        aria-label="间隔分类与成位图"
      >
        <text x={MARGIN_X} y={20} className="dg-title">
          间隔分类（按 τ = {result.tau}µs；长型→位 0，相邻短型对→位 1）
        </text>

        {/* 间隔条：宽度仍严格按时长比例，仅整体比例有下限 */}
        <g className="layer-bars">
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
        </g>
        <Legend W={W} />

        {/* 成位：长型单间隔或短型对（括号 + 固定尺寸位标记） */}
        <g className="layer-bits">
          {bitSpans.map((b, i) => (
            <g key={`bit-${i}`}>
              <path
                d={`M ${b.x + 2} ${ROW_INTERVALS_Y + 44} q 0 8 8 8 h ${Math.max(b.w - 20, 0)} q 8 0 8 -8`}
                className="bracket"
                fill="none"
              />
              <rect x={b.x + b.w / 2 - 11} y={ROW_BITS_Y} width={BIT_BOX_W} height={22} rx={4} className={`bit bit-${b.bit}`} />
              <text x={b.x + b.w / 2} y={ROW_BITS_Y + 16} className="bit-label">
                {b.bit}
              </text>
            </g>
          ))}
        </g>

        {/* 每 5 位一组，标注码值与角色；±2 内缩使相邻组之间保留 4 单位净距 */}
        <g className="layer-groups">
          {result.groups.map((_, gi) => {
            const startBit = gi * 5;
            const endBit = startBit + 4;
            // 以位框外缘为界（不外扩到位跨），最小位间距下相邻组之间仍有净距
            const x0 = bitSpans[startBit].x + bitSpans[startBit].w / 2 - BIT_BOX_W / 2;
            const x1 = bitSpans[endBit].x + bitSpans[endBit].w / 2 + BIT_BOX_W / 2;
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
        </g>
      </svg>
    </div>
  );
}

function Legend({ W }: { W: number }) {
  return (
    <g transform={`translate(${W - 250}, 12)`}>
      <rect x={0} y={0} width={14} height={14} className="bar bar-L" />
      <text x={20} y={11} className="legend-text">长型 (位 0)</text>
      <rect x={100} y={0} width={14} height={14} className="bar bar-S" />
      <text x={120} y={11} className="legend-text">短型对 (位 1)</text>
    </g>
  );
}
