// The left rail, in one place.
//
// The launcher was redesigned into this layout and the other three pages were
// left on the old header-and-buttons markup, so moving between them changed the
// furniture. Copying the rail into each file would have fixed today's seam and
// guaranteed tomorrow's, since the next nav change would have to be made four
// times. Each page supplies an empty <aside id="rail"> and this fills it.
//
// Plain DOM and a classic script on purpose: these pages load two small
// scripts and no framework, and a rail is not a reason to introduce one.

const NAV = [
  {
    href: '/', key: 'navHome', title: 'Home',
    // House.
    paths: ['M3.2 11 12 3.6 20.8 11', 'M5.6 9.4V20.4h12.8V9.4', 'M9.7 20.4v-5.3h4.6v5.3'],
  },
  {
    href: '/builds.html', key: 'navBuilds', title: 'Builds',
    // Four item slots.
    rects: [[3.5, 3.5, 7, 7], [13.5, 3.5, 7, 7], [3.5, 13.5, 7, 7], [13.5, 13.5, 7, 7]],
  },
  {
    href: '/ranking.html', key: 'navLadder', title: 'Ladder',
    // Bar chart, tallest in the middle.
    rects: [[3.5, 12.5, 5, 8], [9.5, 6.5, 5, 14], [15.5, 9.5, 5, 11]],
  },
  {
    href: '/live.html', key: 'navBot', title: 'Live Bot',
    // Heartbeat.
    paths: ['M2.6 12h4.1l2.6-7.4 4.4 15 2.6-7.6h5.1'],
  },
];

const svgNS = 'http://www.w3.org/2000/svg';

function icon(item) {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'lg-ico');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of item.paths || []) {
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  for (const [x, y, w, h] of item.rects || []) {
    const r = document.createElementNS(svgNS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('rx', item.key === 'navLadder' ? 1 : 1.6);
    svg.appendChild(r);
  }
  return svg;
}

function buildShell(rail) {
  if (!rail) return;
  // "/" and "/index.html" are the same page; everything else matches by file.
  const here = location.pathname.replace(/\/index\.html$/, '/') || '/';

  const brand = document.createElement('a');
  brand.className = 'lg-brand';
  brand.href = '/';
  brand.innerHTML = '<span class="lg-logo" aria-hidden="true">⚔</span>' +
    '<h1 class="lg-brand-name">AI LoL Coach</h1>';

  const nav = document.createElement('nav');
  nav.className = 'lg-nav';
  for (const item of NAV) {
    const a = document.createElement('a');
    a.className = 'lg-item' + (item.href === here ? ' active' : '');
    a.href = item.href;
    a.title = item.title;
    a.setAttribute('data-i18n-title', item.key);
    a.appendChild(icon(item));
    const label = document.createElement('span');
    label.setAttribute('data-i18n', item.key);
    label.textContent = item.title;
    a.appendChild(label);
    nav.appendChild(a);
  }

  const foot = document.createElement('div');
  foot.className = 'lg-side-foot';
  // The widget controls only do anything on the launcher, where app.js wires
  // them up and reveals the bar. Elsewhere the markup stays hidden and inert
  // rather than the pages having different rails.
  foot.innerHTML =
    '<div id="launcherBar" class="launcher-bar" hidden>' +
      '<span class="lb-status"><span class="dot on"></span><span id="lbGame"></span></span>' +
      '<button id="lbWidget" class="navbtn lb-btn" type="button"></button>' +
    '</div>' +
    '<select id="lang" class="field lang" aria-label="Language"></select>' +
    '<p class="lg-legal muted" data-i18n="footer">Official Riot API · post-game coaching only · ' +
      'not affiliated with Riot Games</p>';

  rail.append(brand, nav, foot);
}

buildShell(document.getElementById('rail'));
