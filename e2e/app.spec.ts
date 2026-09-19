import { test, expect } from '@playwright/test';
import { encodeDigits } from '../src/encode';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('decoded 判定', () => {
  test('示例“可解码”：展示数字串、τ 列表、SVG 分类成位图与码表', async ({ page }) => {
    await page.getByTestId('sample-decoded').click();

    await expect(page.getByTestId('result-status')).toHaveText('decoded');
    await expect(page.getByTestId('result-digits')).toHaveText('48321');
    // τ=96 编码、容差 6：有效窗口 90..102
    await expect(page.getByTestId('result-tau')).toContainText('90');
    await expect(page.getByTestId('result-tau')).toContainText('102');
    const taus = (await page.getByTestId('result-tau').innerText()).split(', ').map(Number);
    expect(taus).toEqual(Array.from({ length: 13 }, (_, i) => 90 + i));

    // 按最小 τ 绘制：标题注明 τ，存在长短间隔条
    const svg = page.locator('svg.pulse-diagram');
    await expect(svg).toBeVisible();
    await expect(svg.locator('text').filter({ hasText: 'τ = 90µs' })).toHaveCount(1);
    await expect(svg.locator('.bar-L').first()).toBeVisible();
    await expect(svg.locator('.bar-S').first()).toBeVisible();

    // 码表：起始码 11、载荷、结束码 15、LRC
    const table = page.getByTestId('codes-table');
    await expect(table).toContainText('起始码');
    await expect(table).toContainText('结束码');
    await expect(table).toContainText('LRC');
  });

  test('漂移时钟示例（τ=118，窗口被 120 截断）仍唯一解码为 707', async ({ page }) => {
    await page.getByTestId('sample-drift').click();
    await expect(page.getByTestId('result-status')).toHaveText('decoded');
    await expect(page.getByTestId('result-digits')).toHaveText('707');
    const taus = (await page.getByTestId('result-tau').innerText()).split(', ').map(Number);
    expect(taus).toEqual([112, 113, 114, 115, 116, 117, 118, 119, 120]);
  });
});

test.describe('unreadable 判定', () => {
  test('孤立短型输入：无有效 τ，显示 unreadable', async ({ page }) => {
    await page.getByTestId('sample-unreadable').click();
    await expect(page.getByTestId('result-status')).toHaveText('unreadable');
    await expect(page.getByTestId('result-digits')).toHaveCount(0);
  });

  test('全部 τ 枚举行均标记淘汰', async ({ page }) => {
    await page.getByTestId('sample-unreadable').click();
    await page.getByTestId('sweep-summary').click();
    await expect(page.getByTestId('sweep-row')).toHaveCount(41);
    expect(await page.getByTestId('sweep-row[data-ok="1"]').count()).toBe(0);
  });
});

test.describe('输入校验：整份拒绝并清除旧结果', () => {
  test('错误按位置稳定汇总（整份级在前，下标升序）', async ({ page }) => {
    await page.getByTestId('pulse-input').fill('[151, "x", 100, 3.5]');
    const panel = page.getByTestId('input-errors');
    await expect(panel).toBeVisible();
    const items = page.getByTestId('error-item');
    await expect(items).toHaveCount(4);
    const positions = await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-pos')));
    expect(positions).toEqual(['-1', '0', '1', '3']);
    // 校验失败时没有任何结果面板
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
  });

  test('JSON 语法错误整份拒绝', async ({ page }) => {
    await page.getByTestId('pulse-input').fill('not a json');
    await expect(page.getByTestId('input-errors')).toBeVisible();
    const item = page.getByTestId('error-item');
    await expect(item).toHaveCount(1);
    await expect(item).toHaveAttribute('data-pos', '-1');
  });

  test('先合法后非法：旧结果必须被清除；恢复合法后重新解码', async ({ page }) => {
    await page.getByTestId('sample-decoded').click();
    await expect(page.getByTestId('result-status')).toHaveText('decoded');

    await page.getByTestId('pulse-input').fill('');
    await expect(page.getByTestId('result-panel')).toHaveCount(0);

    await page.getByTestId('pulse-input').fill('[1, 2, 3]'); // 长度不足且数值越界
    await expect(page.getByTestId('input-errors')).toBeVisible();
    await expect(page.getByTestId('result-panel')).toHaveCount(0);

    await page.getByTestId('sample-decoded').click();
    await expect(page.getByTestId('result-status')).toHaveText('decoded');
    await expect(page.getByTestId('input-errors')).toHaveCount(0);
  });
});

test.describe('初始状态', () => {
  test('空输入不显示任何结果或错误', async ({ page }) => {
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    await expect(page.getByTestId('input-errors')).toHaveCount(0);
  });
});

/* ----------------------- 成位图横向几何回归 ----------------------- */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 正面积相交（留 0.5px 子像素容差） */
function overlaps(a: Box, b: Box): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + a.h) - Math.max(a.y, b.y);
  return ox > 0.5 && oy > 0.5;
}

/** 读取 SVG 内实际渲染元素的边界（getBoundingClientRect，CSS 像素） */
async function diagramBoxes(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const boxOf = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const svg = document.querySelector('svg.pulse-diagram')!;
    const bars = [...svg.querySelectorAll('g.layer-bars > g')].map((g) => ({
      bar: boxOf(g.querySelector('rect.bar')!),
      cls: g.querySelector('rect.bar')!.classList.contains('bar-L') ? ('L' as const) : ('S' as const),
      label: (g.querySelector('text.bar-label') as SVGTextElement | null)?.getBoundingClientRect()
        ? boxOf(g.querySelector('text.bar-label')!)
        : null,
    }));
    const brackets = [...svg.querySelectorAll('g.layer-bits path.bracket')].map(boxOf);
    const bits = [...svg.querySelectorAll('g.layer-bits > g')].map((g) => ({
      box: boxOf(g.querySelector('rect.bit')!),
      label: boxOf(g.querySelector('text.bit-label')!),
    }));
    const groups = [...svg.querySelectorAll('g.layer-groups > g')].map((g) => ({
      rect: boxOf(g.querySelector('rect.grp')!),
      label: boxOf(g.querySelector('text.grp-label')!),
    }));
    return { bars, brackets, bits, groups };
  });
}

/**
 * 四个图层的几何不变量（基于浏览器实际渲染边界，而非元素存在性）：
 * 间隔条、短型配对括号、固定位框+0/1 标签、5 位分组覆盖层均可见且相邻元素无正面积相交。
 */
async function assertDiagramGeometry(
  page: import('@playwright/test').Page,
  expected: { intervals: number; bits: number; groups: number },
) {
  // 图层本身可见
  for (const cls of ['g.layer-bars', 'g.layer-bits', 'g.layer-groups']) {
    await expect(page.locator(cls)).toBeVisible();
  }

  const geo = await diagramBoxes(page);

  // 间隔分类：数量正确、L/S 两类都在；相邻间隔条不相碰；已显示的时长标签不越界、不互压
  expect(geo.bars).toHaveLength(expected.intervals);
  expect(new Set(geo.bars.map((b) => b.cls))).toEqual(new Set(['L', 'S']));
  for (const b of geo.bars) {
    expect(b.bar.w).toBeGreaterThan(1);
    expect(b.bar.h).toBeGreaterThan(1);
    if (b.label) {
      // 标签水平方向落在所属间隔条内
      expect(b.label.x).toBeGreaterThanOrEqual(b.bar.x - 2);
      expect(b.label.x + b.label.w).toBeLessThanOrEqual(b.bar.x + b.bar.w + 2);
    }
  }
  for (let i = 1; i < geo.bars.length; i++) {
    expect(overlaps(geo.bars[i - 1].bar, geo.bars[i].bar)).toBe(false);
  }
  const shownLabels = geo.bars.filter((b) => b.label).map((b) => b.label!);
  for (let i = 1; i < shownLabels.length; i++) {
    expect(overlaps(shownLabels[i - 1], shownLabels[i])).toBe(false);
  }

  // 短型配对括号：每位一个，相邻不相碰
  expect(geo.brackets).toHaveLength(expected.bits);
  for (const br of geo.brackets) {
    expect(br.w).toBeGreaterThan(10);
    expect(br.h).toBeGreaterThan(1);
  }
  for (let i = 1; i < geo.brackets.length; i++) {
    expect(overlaps(geo.brackets[i - 1], geo.brackets[i])).toBe(false);
  }

  // 成位框与 0/1 标签：数量正确；固定尺寸不被压缩；相邻位的框/标签四种组合均不正面积相交
  expect(geo.bits).toHaveLength(expected.bits);
  let minCenterGap = Infinity;
  for (const b of geo.bits) {
    expect(b.box.w).toBeGreaterThanOrEqual(20);
    expect(b.box.h).toBeGreaterThanOrEqual(20);
    expect(b.label.w).toBeGreaterThan(1);
    expect(b.label.h).toBeGreaterThan(1);
  }
  for (let i = 1; i < geo.bits.length; i++) {
    const prev = geo.bits[i - 1];
    const cur = geo.bits[i];
    expect(overlaps(prev.box, cur.box)).toBe(false);
    expect(overlaps(prev.label, cur.label)).toBe(false);
    expect(overlaps(prev.box, cur.label)).toBe(false);
    expect(overlaps(prev.label, cur.box)).toBe(false);
    minCenterGap = Math.min(minCenterGap, cur.box.x + cur.box.w / 2 - (prev.box.x + prev.box.w / 2));
  }
  // 中心间距不得小于框宽（修复前仅 12.8，框宽 22）
  expect(minCenterGap).toBeGreaterThanOrEqual(geo.bits[0].box.w - 0.5);

  // 5 位分组覆盖层：数量正确；相邻组框不相交、标签不互压且标签水平落在本组内
  expect(geo.groups).toHaveLength(expected.groups);
  for (const g of geo.groups) {
    expect(g.rect.w).toBeGreaterThan(1);
    expect(g.rect.h).toBeGreaterThan(1);
    expect(g.label.x).toBeGreaterThanOrEqual(g.rect.x - 2);
    expect(g.label.x + g.label.w).toBeLessThanOrEqual(g.rect.x + g.rect.w + 2);
  }
  for (let i = 1; i < geo.groups.length; i++) {
    expect(overlaps(geo.groups[i - 1].rect, geo.groups[i].rect)).toBe(false);
    expect(overlaps(geo.groups[i - 1].label, geo.groups[i].label)).toBe(false);
  }
}

test.describe('成位图横向几何：1..12 位载荷均清晰可读', () => {
  const maxDurations = encodeDigits('123456789012', 100);

  async function submitDurations(page: import('@playwright/test').Page, durations: number[]) {
    await page.getByTestId('pulse-input').fill(JSON.stringify(durations));
    await expect(page.getByTestId('result-status')).toHaveText('decoded');
  }

  test('最大合法帧（108 间隔 / 75 位）：经输入链路提交后四层标记均不重叠', async ({ page }) => {
    // 修复前：75 位挤在 960 单位内，最小中心间距 12.8 < 框宽 22
    expect(maxDurations).toHaveLength(108);
    await submitDurations(page, maxDurations);

    await expect(page.getByTestId('result-digits')).toHaveText('123456789012');
    expect(await page.locator('g.layer-bits > g').count()).toBe(75);

    // 位值数量与协议一致（42 个长型 0、33 个短型对 1）
    expect(await page.locator('rect.bit-0').count()).toBe(42);
    expect(await page.locator('rect.bit-1').count()).toBe(33);

    await assertDiagramGeometry(page, { intervals: 108, bits: 75, groups: 15 });
  });

  test('1 位载荷短帧：仍可解码，且不被长帧布局策略破坏', async ({ page }) => {
    const short = encodeDigits('7', 100); // 起始 + 1 载荷 + 结束 + LRC = 4 组 20 位
    await submitDurations(page, short);

    await expect(page.getByTestId('result-digits')).toHaveText('7');
    expect(await page.locator('g.layer-bits > g').count()).toBe(20);
    await expect(page.locator('g.layer-bars rect.bar-L').first()).toBeVisible();
    await expect(page.locator('g.layer-bars rect.bar-S').first()).toBeVisible();

    await assertDiagramGeometry(page, { intervals: short.length, bits: 20, groups: 4 });
  });

  test('窄视口重新输入最大帧：不压缩回重叠宽度，可横向滚动到最右侧位框', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await submitDurations(page, maxDurations);
    await expect(page.getByTestId('result-digits')).toHaveText('123456789012');

    // 窄视口下同样满足全部相邻边界不相交
    await assertDiagramGeometry(page, { intervals: 108, bits: 75, groups: 15 });

    const scroll = page.getByTestId('diagram-scroll');
    const metrics = await scroll.evaluate((el) => {
      const before = el.scrollLeft;
      el.scrollLeft = el.scrollWidth; // 实际改变滚动位置
      return {
        before,
        left: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      };
    });

    // 内容宽于可视区域，且确实滚到了右端
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
    expect(metrics.before).toBe(0);
    expect(metrics.left).toBeGreaterThan(0);
    expect(metrics.left + metrics.clientWidth).toBeGreaterThanOrEqual(metrics.scrollWidth - 2);

    // 最右侧成位框滚动后落在可视区域内
    const reach = await page.evaluate(() => {
      const sc = document.querySelector('[data-testid="diagram-scroll"]')!;
      const bits = document.querySelectorAll('g.layer-bits > g');
      const last = bits[bits.length - 1].querySelector('rect.bit')!.getBoundingClientRect();
      const cr = sc.getBoundingClientRect();
      return { left: last.left, right: last.right, cLeft: cr.left, cRight: cr.right };
    });
    expect(reach.right).toBeLessThanOrEqual(reach.cRight + 1);
    expect(reach.right).toBeGreaterThan(reach.cLeft);
  });
});
