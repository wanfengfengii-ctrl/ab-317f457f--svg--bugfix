import { test, expect, type Page } from '@playwright/test';

/** 按协议构造完整帧：起始码 11 + 载荷 + 结束码 15 + LRC；τ 默认为 100 */
function encodeFrame(digits: string, tau = 100): number[] {
  const toBits = (c: number): number[] => {
    const b = [c & 1, (c >> 1) & 1, (c >> 2) & 1, (c >> 3) & 1];
    b.push(b.reduce((a, v) => a + v, 0) % 2 === 0 ? 1 : 0);
    return b;
  };
  const codes = [11, ...[...digits].map(Number), 15];
  codes.push(codes.reduce((a, v) => a ^ v, 0));
  return codes.flatMap(toBits).flatMap((b) => (b ? [tau / 2, tau / 2] : [tau]));
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxesOf(page: Page, selector: string): Promise<Box[]> {
  return page.locator(selector).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
}

/** 相邻元素不允许正面积相交（边沿相切允许）；返回违例下标对 */
function adjacentOverlaps(boxes: Box[], tolerance = 0.5): [number, number][] {
  const bad: [number, number][] = [];
  for (let i = 1; i < boxes.length; i++) {
    const a = boxes[i - 1];
    const b = boxes[i];
    const ow = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ow > tolerance && oh > tolerance) bad.push([i - 1, i]);
  }
  return bad;
}

/** 所有图层的标记都已显示，且相邻标记没有因压缩而正面积相交 */
async function assertDiagramGeometry(
  page: Page,
  opts: { intervals: number; bits: number; groups: number; shortPairs: number; longBits: number },
) {
  const svg = page.locator('svg.pulse-diagram');
  await expect(svg).toBeVisible();

  // 间隔分类：每个间隔一条；长短两类数量与编码一致
  await expect(page.locator('[data-testid="interval-mark"]')).toHaveCount(opts.intervals);
  await expect(page.locator('[data-testid="interval-mark"] .bar-S')).toHaveCount(opts.shortPairs * 2);
  await expect(page.locator('[data-testid="interval-mark"] .bar-L')).toHaveCount(opts.longBits);

  // 成位结果：75/20 个固定尺寸位框与 0/1 标签，相邻者两两不相交
  const bitBoxes = await boxesOf(page, '[data-testid="bit-mark"] rect.bit');
  expect(bitBoxes).toHaveLength(opts.bits);
  for (const b of bitBoxes) {
    expect(b.w).toBeGreaterThanOrEqual(22 - 0.5);
    expect(b.h).toBeGreaterThanOrEqual(22 - 0.5);
  }
  expect(adjacentOverlaps(bitBoxes)).toEqual([]);
  const bitLabels = await boxesOf(page, '[data-testid="bit-mark"] text.bit-label');
  expect(bitLabels).toHaveLength(opts.bits);
  expect(adjacentOverlaps(bitLabels)).toEqual([]);

  // 短型配对括号：每个 1 位（短型对）都有一个正尺寸括号
  const brackets = page.locator('[data-testid="bit-mark"][data-bit="1"] path.bracket');
  await expect(brackets).toHaveCount(opts.shortPairs);
  const bracketBoxes = await boxesOf(page, '[data-testid="bit-mark"][data-bit="1"] path.bracket');
  for (const b of bracketBoxes) {
    expect(b.w).toBeGreaterThan(20);
    expect(b.h).toBeGreaterThan(2);
  }

  // 间隔条本身相邻也不重叠
  const intervalBoxes = await boxesOf(page, '[data-testid="interval-mark"] rect.bar');
  expect(intervalBoxes).toHaveLength(opts.intervals);
  expect(adjacentOverlaps(intervalBoxes)).toEqual([]);

  // 5 位分组覆盖层：数量正确，相邻分组框与标签均不相交
  await expect(page.locator('[data-testid="group-mark"]')).toHaveCount(opts.groups);
  const groupBoxes = await boxesOf(page, '[data-testid="group-mark"] rect.grp');
  expect(groupBoxes).toHaveLength(opts.groups);
  expect(adjacentOverlaps(groupBoxes)).toEqual([]);
  const groupLabels = await boxesOf(page, '[data-testid="group-mark"] text.grp-label');
  expect(groupLabels).toHaveLength(opts.groups);
  expect(adjacentOverlaps(groupLabels)).toEqual([]);
}

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

test.describe('成位图几何回归：相邻成位框/标签不得重叠', () => {
  test('12 位载荷最大帧（108 间隔→75 位）：逐对边界不相交，各图层齐全', async ({ page }) => {
    const durations = encodeFrame('123456789012', 100);
    expect(durations).toHaveLength(108);
    const shortPairs = durations.filter((d) => d === 50).length / 2;
    const longBits = durations.filter((d) => d === 100).length;
    expect(shortPairs + longBits).toBe(75);

    await page.getByTestId('pulse-input').fill(JSON.stringify(durations));
    await expect(page.getByTestId('result-status')).toHaveText('decoded');
    await expect(page.getByTestId('result-digits')).toHaveText('123456789012');

    await assertDiagramGeometry(page, {
      intervals: 108,
      bits: 75,
      groups: 15,
      shortPairs,
      longBits,
    });
  });

  test('1 位载荷短帧：仍可解码，各图层可见且未被长帧布局策略破坏', async ({ page }) => {
    const durations = encodeFrame('7', 100);
    const shortPairs = durations.filter((d) => d === 50).length / 2;
    const longBits = durations.filter((d) => d === 100).length;
    expect(shortPairs + longBits).toBe(20);

    await page.getByTestId('pulse-input').fill(JSON.stringify(durations));
    await expect(page.getByTestId('result-status')).toHaveText('decoded');
    await expect(page.getByTestId('result-digits')).toHaveText('7');

    await assertDiagramGeometry(page, {
      intervals: durations.length,
      bits: 20,
      groups: 4,
      shortPairs,
      longBits,
    });
  });

  test('窄视口：最大帧不被压回重叠宽度，可横向滚动到最右侧内容', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const durations = encodeFrame('123456789012', 100);
    const shortPairs = durations.filter((d) => d === 50).length / 2;
    const longBits = durations.filter((d) => d === 100).length;

    await page.getByTestId('pulse-input').fill(JSON.stringify(durations));
    await expect(page.getByTestId('result-status')).toHaveText('decoded');

    const scroller = page.locator('[data-testid="diagram-scroll"]');
    const metrics = await scroller.evaluate((el) => ({
      clientW: el.clientWidth,
      scrollW: el.scrollWidth,
    }));
    // 最大帧内容宽于窄视口：必须产生横向滚动而不是压缩
    expect(metrics.scrollW).toBeGreaterThan(metrics.clientW);

    // 滚动前相邻框/标签也不相交（不能靠滚动掩盖压缩）
    await assertDiagramGeometry(page, {
      intervals: 108,
      bits: 75,
      groups: 15,
      shortPairs,
      longBits,
    });

    // 实际改变 scrollLeft，确认能到达最右侧，而不是把整图压回重叠宽度
    await scroller.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    const afterScroll = await scroller.evaluate((el) => ({
      scrollLeft: el.scrollLeft,
      maxScroll: el.scrollWidth - el.clientWidth,
    }));
    expect(afterScroll.maxScroll).toBeGreaterThan(0);
    expect(afterScroll.scrollLeft).toBeCloseTo(afterScroll.maxScroll, 0);

    const lrcLabel = page.locator('[data-testid="group-mark"] text.grp-label').last();
    await expect(lrcLabel).toContainText('LRC');
    await expect(lrcLabel).toBeVisible();
    const lrcBox = await lrcLabel.boundingBox();
    expect(lrcBox).not.toBeNull();
    expect(lrcBox!.x).toBeGreaterThan(0);
    expect(lrcBox!.x + lrcBox!.width).toBeLessThanOrEqual(375 + 1);

    // 滚回左端后起始分组仍可见（滚动不破坏布局）
    await scroller.evaluate((el) => {
      el.scrollLeft = 0;
    });
    const startLabel = page.locator('[data-testid="group-mark"] text.grp-label').first();
    await expect(startLabel).toContainText('起始');
    await expect(startLabel).toBeVisible();
  });
});
