import { expect, test } from '@playwright/test';

test('visitor can browse, filter, open detail, and see source notice', async ({ page }) => {
  await page.goto('/events');
  await expect(page.getByRole('heading', { level: 1, name: 'Upcoming events' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('result');
  await page.getByLabel('Category').selectOption({ label: 'Music' });
  await expect(page).toHaveURL(/category=Music/u);
  await page.getByRole('link', { name: 'Riverfront Jazz Evening' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Riverfront Jazz Evening' })).toBeVisible();
  await expect(page.getByRole('link', { name: /View original source.*external website/u })).toHaveAttribute('href', 'https://example.org/riverfront-jazz');
});

test('event index reflows without horizontal page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1024 });
  await page.goto('/events');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
