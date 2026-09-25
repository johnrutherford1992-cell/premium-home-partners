// `test` for every spec: Playwright's test plus a console guard that fails a
// test when any page it drives logs console.error or throws (pageerror).
//
// The guard covers the built-in `page`/`context` fixtures and every context
// opened through helpers.openAs() (multi-role specs), including contexts a
// describe-level beforeAll opened: their errors are charged to the test that
// is running (or the next one to finish), so nothing slips through between tests.
//
// Allowlist: nothing by default. A test that causes an error on purpose calls
// allowConsoleErrors(pattern, reason) for that test only; the reason must say
// why the error is expected and benign.

import { test as base, expect, type BrowserContext, type ConsoleMessage, type WebError } from '@playwright/test';

export { expect };

interface Captured {
  source: string;
  text: string;
}

const captured: Captured[] = [];
let allowed: { pattern: RegExp; reason: string }[] = [];
const guarded = new WeakSet<BrowserContext>();

function where(m: ConsoleMessage): string {
  const loc = m.location();
  return loc?.url ? ` @ ${loc.url}${loc.lineNumber ? `:${loc.lineNumber}` : ''}` : '';
}

/** Start collecting console.error / pageerror from every page in this context. */
export function guardConsole(context: BrowserContext, source: string): void {
  if (guarded.has(context)) return;
  guarded.add(context);
  context.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') captured.push({ source, text: `console.error: ${m.text()}${where(m)}` });
  });
  context.on('weberror', (e: WebError) => {
    const err = e.error();
    captured.push({ source, text: `pageerror: ${err.stack || err.message}` });
  });
}

/**
 * Let this test pass despite console errors matching `pattern` (tested against
 * "console.error: <text> @ <url>"). Only for errors the test provokes on purpose.
 */
export function allowConsoleErrors(pattern: RegExp, reason: string): void {
  if (!reason.trim()) throw new Error('allowConsoleErrors needs a reason.');
  allowed.push({ pattern, reason });
}

export const test = base.extend<{ consoleGuard: void }>({
  context: async ({ context }, use, testInfo) => {
    guardConsole(context, testInfo.project.name);
    await use(context);
  },
  consoleGuard: [
    async ({}, use, testInfo) => {
      allowed = [];
      await use();
      const all = captured.splice(0);
      const errors = all.filter((c) => !allowed.some((a) => a.pattern.test(c.text)));
      const tolerated = all.length - errors.length;
      if (tolerated) {
        testInfo.annotations.push({
          type: 'console-allowlist',
          description: `${tolerated} expected console error(s): ${allowed.map((a) => a.reason).join(' | ')}`,
        });
      }
      if (errors.length) {
        const body = errors.map((e) => `[${e.source}] ${e.text}`).join('\n');
        await testInfo.attach('console-errors.txt', { body, contentType: 'text/plain' });
        throw new Error(`The app logged ${errors.length} console error(s) during this test:\n${body}`);
      }
    },
    { auto: true },
  ],
});
