import type { TauSuccess } from './decode';

interface Props {
  durations: number[];
  result: TauSuccess;
}

/**
 * 横向布局（所有图层共用同一套“内容坐标”，绝不为窄视口压缩）：
 *  - 间隔条按时长比例绘制，但最短间隔也不窄于 MIN_BAR，保证 50/100 标签可读；
 *  - 相邻成位中心距不小于 BIT_PITCH，固定 22×22 的位标记与 0/1 标签因此永不重叠；
 *  - 5 位分组覆盖层按位格子左右内缩 GROUP_INSET，相邻分组间留有间隙。
 * SVG 按内容宽度生成（viewBox + 显式宽高），超出容器时由横向滚动容器承载。
 */
const MARGIN_X = 24;
const ROW_INTERVALS_Y = 56;
const ROW_BITS_Y = 132;
const ROW_GROUPS_Y = 190;
const H = 246;

const MIN_BAR = 34; // 最短间隔（50µs）的最小宽度，保证间隔条与其时长标签可读
const BIT_PITCH = 34; // 相邻成位中心的最小间距（最密情况即相邻两个短型对）
const BIT_BOX = 22; // 位标记固定边长（< BIT_PITCH，相邻框间至少留 12 单位）
const GROUP_INSET = 3; // 分组框相对 5 个位格子左右内缩，相邻分组间留出 6px 间隙

export default function PulseDiagram({ durations, result }: Props) {
  const total = durations.reduce((a, b) => a + b, 0);

  // 比例尺度：既要让最短间隔（50µs）不窄于 MIN_BAR，
  // 也要让最密的“连续短型对”成位中心距（=一个短间隔宽）不小于 BIT_PITCH。
  const scale = Math.max(MIN_BAR / 50, BIT_PITCH / 50);

  // 每个间隔的横向区间（宽度按时长比例；scale 取了下限，所以不会被压缩）
  const spans: { x: number; w: number; d: number; cls: 'L' | 'S' }[] = [];
  let acc = 0;
  durations.forEach((d, i) => {
    spans.push({ x: MARGIN_X + acc * scale, w: d * scale, d, cls: result.classes[i] });
    acc += d;
  });

  const contentW = MARGIN_X + total * scale + MARGIN_X;

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
        viewBox={`0 0 ${contentW} ${H}`}
        width={contentW}
        height={H}
        role="img"
        aria-label="间隔分类与成位图"
      >
        <text x={MARGIN_X} y={20} className="dg-title">
          间隔分类（按 τ = {result.tau}µs；长型→位 0，相邻短型对→位 1）
        </text>

        {/* 间隔条 */}
        {spans.map((s, i) => (
          <g key={`iv-${i}`} data-testid="interval-mark">
            <rect x={s.x} y={ROW_INTERVALS_Y} width={Math.max(s.w - 1, 1)} height={34} className={`bar bar-${s.cls}`} />
            {s.w >= 26 && (
              <text x={s.x + s.w / 2} y={ROW_INTERVALS_Y + 21} className="bar-label">
                {s.d}
              </text>
            )}
          </g>
        ))}
        <Legend contentW={contentW} />

        {/* 成位：长型单间隔或短型对；括号即为“短型配对”标记 */}
        {bitSpans.map((b, i) => (
          <g key={`bit-${i}`} data-testid="bit-mark" data-bit={b.bit}>
            <path
              d={`M ${b.x + 2} ${ROW_INTERVALS_Y + 44} q 0 8 8 8 h ${Math.max(b.w - 20, 0)} q 8 0 8 -8`}
              className="bracket"
              fill="none"
            />
            <rect
              x={b.x + b.w / 2 - BIT_BOX / 2}
              y={ROW_BITS_Y}
              width={BIT_BOX}
              height={BIT_BOX}
              rx={4}
              className={`bit bit-${b.bit}`}
            />
            <text x={b.x + b.w / 2} y={ROW_BITS_Y + 16} className="bit-label">
              {b.bit}
            </text>
          </g>
        ))}

        {/* 每 5 位一组，标注码值与角色；相邻分组框之间留有 2*GROUP_INSET 间隙 */}
        {result.groups.map((_, gi) => {
          const startBit = gi * 5;
          const endBit = startBit + 4;
          const x0 = bitSpans[startBit].x + GROUP_INSET;
          const x1 = bitSpans[endBit].x + bitSpans[endBit].w - GROUP_INSET;
          const role =
            gi === 0
              ? 'grp-start'
              : gi === result.groups.length - 1
                ? 'grp-lrc'
                : gi === result.groups.length - 2
                  ? 'grp-end'
                  : 'grp-data';
          return (
            <g key={`grp-${gi}`} data-testid="group-mark">
              <rect x={x0} y={ROW_GROUPS_Y} width={x1 - x0} height={40} rx={6} className={`grp ${role}`} />
              <text x={(x0 + x1) / 2} y={ROW_GROUPS_Y + 25} className="grp-label">
                {groupLabels[gi]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Legend({ contentW }: { contentW: number }) {
  return (
    <g transform={`translate(${contentW - MARGIN_X - 250}, 12)`}>
      <rect x={0} y={0} width={14} height={14} className="bar bar-L" />
      <text x={20} y={11} className="legend-text">长型 (位 0)</text>
      <rect x={100} y={0} width={14} height={14} className="bar bar-S" />
      <text x={120} y={11} className="legend-text">短型对 (位 1)</text>
    </g>
  );
}
