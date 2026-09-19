import { test, expect } from '@playwright/test';

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
