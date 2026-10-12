// -----------------------------------------------------------------------------
// Draw the device pictures of the "Dyson controls" widget (assets/devices).
//
// Dyson product photos are not ours to ship and the account API gives none, so
// the widget shows a drawing of the product family, in the style of the
// catalog cover: one per silhouette, fan running (air lines, lit LED) or off.
//
//   npm install --no-save playwright && node .github/scripts/device-pictures.mjs
//
// Chromium renders each SVG to a 16:9 JPEG (the frame of the widget image):
// small, and the dark background reads the same in light and dark themes.
// After a change, bump PICTURE_VERSION in src/capabilities/widget.js: the core
// caches an image one hour by key.
// -----------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';

const WIDTH = 800;
const HEIGHT = 450;
const PINK = '#e6007e';

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#16151a"/><stop offset="1" stop-color="#08080a"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.45" r="0.5">
      <stop offset="0" stop-color="${PINK}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${PINK}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="silver" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8d9096"/><stop offset="0.3" stop-color="#f2f3f5"/>
      <stop offset="0.55" stop-color="#c3c6cb"/><stop offset="1" stop-color="#6f7278"/>
    </linearGradient>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#1b1b1f"/><stop offset="0.45" stop-color="#2c2c32"/>
      <stop offset="1" stop-color="#111114"/>
    </linearGradient>
    <linearGradient id="hole" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#050506"/><stop offset="1" stop-color="#121216"/>
    </linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7fb6d9" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#2f6f99" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="air" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.7"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <pattern id="dots" width="9" height="9" patternUnits="userSpaceOnUse">
      <circle cx="4.5" cy="4.5" r="1.3" fill="#4a4a52"/>
    </pattern>
  </defs>`;

/** A loop (stadium) of outer size w x h, centred on x, from y, rim t. */
function loop(x, y, w, h, t = 13) {
  const outer = `M ${x - w / 2} ${y + w / 2} a ${w / 2} ${w / 2} 0 0 1 ${w} 0 V ${y + h - w / 2} a ${w / 2} ${w / 2} 0 0 1 ${-w} 0 Z`;
  const iw = w - 2 * t;
  const inner = `M ${x - iw / 2} ${y + t + iw / 2} a ${iw / 2} ${iw / 2} 0 0 1 ${iw} 0 V ${y + h - t - iw / 2} a ${iw / 2} ${iw / 2} 0 0 1 ${-iw} 0 Z`;
  return `<path d="${inner}" fill="url(#hole)"/>
    <path d="${outer} ${inner}" fill="url(#silver)" fill-rule="evenodd"/>`;
}

/** The Hot+Cool loop: round on top, narrowing towards the base. */
function bulb(x, y, r, h, bottom, t = 13) {
  const shape = (rr, top, end, half) =>
    `M ${x - rr} ${top + rr} a ${rr} ${rr} 0 0 1 ${2 * rr} 0 L ${x + half} ${end - half} a ${half} ${half} 0 0 1 ${-2 * half} 0 Z`;
  const outer = shape(r, y, y + h, bottom / 2);
  const inner = shape(r - t, y + t, y + h - t, bottom / 2 - t);
  return `<path d="${inner}" fill="url(#hole)"/>
    <path d="${outer} ${inner}" fill="url(#silver)" fill-rule="evenodd"/>`;
}

/** Neck, pink ring and perforated cylinder base, from y to bottom. */
function base(x, y, w, bottom, on, neck = 14) {
  return `<rect x="${x - 14}" y="${y}" width="28" height="${neck}" fill="url(#silver)"/>
    <rect x="${x - w / 2 - 3}" y="${y + neck}" width="${w + 6}" height="9" rx="2" fill="${PINK}"/>
    <rect x="${x - w / 2}" y="${y + neck + 9}" width="${w}" height="${bottom - y - neck - 9}" rx="8" fill="url(#body)"/>
    <rect x="${x - w / 2 + 8}" y="${y + neck + 18}" width="${w - 16}" height="${bottom - y - neck - 48}" fill="url(#dots)"/>
    ${led(x, bottom - 18, on)}`;
}

function led(x, y, on) {
  return `<rect x="${x - 11}" y="${y - 4}" width="22" height="8" rx="4" fill="#0a0a0c"/>
    <circle cx="${x}" cy="${y}" r="2.4" fill="${on ? PINK : '#3a3a40'}"/>`;
}

/** Air lines leaving the product towards the left, at the given heights. */
function air(fromX, ys, length = 230) {
  return ys
    .map(
      (y, i) =>
        `<path d="M ${fromX} ${y} C ${fromX - length * 0.4} ${y - 6 + i * 3}, ${fromX - length * 0.7} ${y + 8 - i * 4}, ${fromX - length} ${y + 4}" stroke="url(#air)" stroke-width="1.6" fill="none"/>`,
    )
    .join('\n    ');
}

const shadow = (x, w) =>
  `<ellipse cx="${x}" cy="418" rx="${w}" ry="9" fill="#000000" opacity="0.6"/>`;

// One drawing per silhouette. `on`: the fan runs.
const FAMILIES = {
  // Pure Cool / Purifier Cool towers, Pure Cool Link.
  tower: (on) => `
    ${on ? air(345, [95, 135, 175, 215]) : ''}
    ${loop(400, 35, 110, 240)}
    ${base(400, 275, 116, 412, on)}
    ${shadow(400, 80)}`,
  // Pure Hot+Cool, Hot+Cool Link.
  'hot-cool': (on) => `
    ${on ? air(342, [100, 140, 180]) : ''}
    ${bulb(400, 45, 60, 225, 60)}
    ${base(400, 270, 116, 412, on)}
    ${shadow(400, 80)}`,
  // Pure Cool desk fans.
  desk: (on) => `
    ${on ? air(345, [160, 200, 240]) : ''}
    ${loop(400, 105, 110, 175)}
    ${base(400, 280, 116, 412, on)}
    ${shadow(400, 80)}`,
  // Humidify+Cool: a loop on a wide body with its water tank.
  humidifier: (on) => `
    ${on ? air(350, [90, 130, 170]) : ''}
    ${loop(400, 35, 100, 200)}
    <rect x="386" y="235" width="28" height="14" fill="url(#silver)"/>
    <rect x="312" y="249" width="176" height="9" rx="2" fill="${PINK}"/>
    <rect x="315" y="258" width="170" height="154" rx="22" fill="url(#body)"/>
    <rect x="327" y="270" width="146" height="56" rx="10" fill="url(#dots)"/>
    <rect x="327" y="336" width="146" height="50" rx="10" fill="url(#water)"/>
    ${led(400, 396, on)}
    ${shadow(400, 110)}`,
  // Big+Quiet: a tall column under a tilted cone.
  'big-quiet': (on) => `
    ${on ? air(352, [70, 100, 130], 210) : ''}
    <path d="M 335 190 L 352 70 L 448 70 L 465 190 Z" fill="url(#body)"/>
    <ellipse cx="400" cy="70" rx="48" ry="14" fill="url(#silver)"/>
    <ellipse cx="400" cy="71" rx="36" ry="9" fill="url(#hole)"/>
    <rect x="331" y="190" width="138" height="9" rx="2" fill="${PINK}"/>
    <rect x="335" y="199" width="130" height="213" rx="10" fill="url(#body)"/>
    <rect x="345" y="210" width="110" height="160" fill="url(#dots)"/>
    ${led(400, 394, on)}
    ${shadow(400, 95)}`,
};

function svg(draw, on) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  ${defs}
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <ellipse cx="400" cy="210" rx="${on ? 300 : 220}" ry="${on ? 220 : 170}" fill="url(#glow)" opacity="${on ? 1 : 0.45}"/>
  ${draw(on)}
</svg>`;
}

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
const out = new URL('../../assets/devices/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [family, draw] of Object.entries(FAMILIES)) {
  for (const on of [true, false]) {
    await page.setContent(
      `<html><body style="margin:0;background:#08080a">${svg(draw, on)}</body></html>`,
    );
    const jpeg = await page.screenshot({ type: 'jpeg', quality: 88 });
    const name = `${family}-${on ? 'on' : 'off'}.jpg`;
    writeFileSync(new URL(name, out), jpeg);
    console.log(`${name}: ${jpeg.length} bytes`);
  }
}
await browser.close();
