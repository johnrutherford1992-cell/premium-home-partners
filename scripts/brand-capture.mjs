// Captures a website's branding for reference: full-page screenshots (desktop
// and phone), visible text, computed colors and fonts, and logo/icon files.
// Usage: node scripts/brand-capture.mjs <url> <outDir>
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const [start, outDir] = process.argv.slice(2);
if (!start || !outDir) {
  console.error('usage: node scripts/brand-capture.mjs <url> <outDir>');
  process.exit(1);
}
const origin = new URL(start).origin;
const MAX_PAGES = 8;

await mkdir(join(outDir, 'assets'), { recursive: true });
const browser = await chromium.launch();
const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const slug = (u) => (new URL(u).pathname.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home').slice(0, 60);
const queue = [start];
const seen = new Set();
const report = { origin, pages: [], assets: [] };
const assetUrls = new Set();

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  // Trigger lazy content, then return to the top.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
}

while (queue.length && report.pages.length < MAX_PAGES) {
  const url = queue.shift();
  if (seen.has(url)) continue;
  seen.add(url);
  const page = await desktop.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    console.error('skip', url, e.message);
    await page.close();
    continue;
  }
  await settle(page);
  const name = slug(url);
  await page.screenshot({ path: join(outDir, `${name}-desktop.jpg`), fullPage: true, type: 'jpeg', quality: 70 });

  const info = await page.evaluate(() => {
    const colors = {};
    const fonts = {};
    const bump = (map, k, where) => {
      if (!k || k === 'rgba(0, 0, 0, 0)' || k === 'transparent') return;
      map[k] ??= { count: 0, where: new Set() };
      map[k].count++;
      map[k].where.add(where);
    };
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const tag = el.tagName.toLowerCase();
      const role = /^h[1-6]$/.test(tag) ? 'heading' : tag === 'a' || tag === 'button' ? 'link/button' : tag === 'nav' || el.closest('header,nav') ? 'header/nav' : el.closest('footer') ? 'footer' : 'body';
      bump(colors, cs.color, `text:${role}`);
      bump(colors, cs.backgroundColor, `bg:${role}`);
      if (cs.borderTopWidth !== '0px') bump(colors, cs.borderTopColor, `border:${role}`);
      bump(fonts, `${cs.fontFamily} | ${cs.fontWeight} | ${cs.fontSize}${cs.textTransform !== 'none' ? ' | ' + cs.textTransform : ''}${cs.letterSpacing !== 'normal' ? ' | ls ' + cs.letterSpacing : ''}`, role);
    }
    const out = (m) => Object.entries(m).sort((a, b) => b[1].count - a[1].count).map(([k, v]) => ({ value: k, count: v.count, where: [...v.where] }));
    const imgs = [...document.querySelectorAll('img, svg, [style*="background-image"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        src: el.currentSrc || el.getAttribute('src') || (getComputedStyle(el).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1] ?? null),
        alt: el.getAttribute('alt'),
        cls: typeof el.className === 'string' ? el.className : el.getAttribute('class'),
        inHeader: !!el.closest('header, nav'),
        w: Math.round(r.width),
        h: Math.round(r.height),
        svg: el.tagName.toLowerCase() === 'svg' && el.closest('header, nav, a') ? el.outerHTML.slice(0, 20000) : undefined,
      };
    });
    const icons = [...document.querySelectorAll('link[rel*="icon"], meta[property="og:image"], meta[name="twitter:image"]')].map((l) => l.href || l.content);
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({ href: a.href, text: a.innerText.trim().slice(0, 80) }));
    const cssVars = {};
    for (const sheet of [...document.styleSheets]) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText === ':root' || rule.selectorText === 'body' || rule.selectorText === 'html') {
            for (const p of rule.style) if (p.startsWith('--')) cssVars[p] = rule.style.getPropertyValue(p).trim();
          }
        }
      } catch {
        // cross-origin stylesheet
      }
    }
    const fontLinks = [...document.querySelectorAll('link[href*="fonts"], link[href*="typekit"], style')].map((l) => l.href || (l.textContent.match(/@font-face[^}]+}/g) ?? []).join('\n').slice(0, 4000)).filter(Boolean);
    return {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content ?? null,
      text: document.body.innerText,
      colors: out(colors),
      fonts: out(fonts),
      imgs,
      icons,
      links,
      cssVars,
      fontLinks,
      themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null,
    };
  });
  await writeFile(join(outDir, `${name}.txt`), `${url}\n${info.title}\n${info.description ?? ''}\n\n${info.text}\n`);
  for (const i of info.imgs) if (i.src && !i.src.startsWith('data:')) assetUrls.add(i.src);
  for (const i of info.icons) if (i) assetUrls.add(i);
  for (const l of info.links) {
    try {
      const u = new URL(l.href);
      u.hash = '';
      if (u.origin === origin && !seen.has(u.href) && !queue.includes(u.href) && !/\.(pdf|jpe?g|png|gif|svg|webp|zip)$/i.test(u.pathname)) queue.push(u.href);
    } catch {
      // ignore bad hrefs
    }
  }
  report.pages.push({ url, name, ...info, text: undefined });
  await page.close();

  const p2 = await phone.newPage();
  try {
    await p2.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await settle(p2);
    await p2.screenshot({ path: join(outDir, `${name}-phone.jpg`), fullPage: true, type: 'jpeg', quality: 70 });
  } catch (e) {
    console.error('phone skip', url, e.message);
  }
  await p2.close();
}

// Download images and icons (logos first; skip very large photos).
let n = 0;
for (const src of assetUrls) {
  if (n >= 40) break;
  try {
    const res = await desktop.request.get(src, { timeout: 20000 });
    if (!res.ok()) continue;
    const body = await res.body();
    if (body.length > 1_500_000) continue;
    const type = res.headers()['content-type'] ?? '';
    const ext = (new URL(src).pathname.match(/\.(png|jpe?g|svg|webp|gif|ico|avif)$/i)?.[1] ?? type.split('/')[1]?.split(';')[0] ?? 'bin').toLowerCase();
    const file = `asset-${String(++n).padStart(2, '0')}-${slug(src).slice(-40)}.${ext.replace('svg+xml', 'svg').replace('x-icon', 'ico').replace('vnd.microsoft.icon', 'ico')}`;
    await writeFile(join(outDir, 'assets', file), body);
    report.assets.push({ src, file, bytes: body.length, type });
  } catch (e) {
    console.error('asset skip', src, e.message);
  }
}

await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
console.log(`captured ${report.pages.length} pages, ${report.assets.length} assets`);
