// Generates live, animated SVG cards for the GitHub profile README.
// Runs in GitHub Actions (see .github/workflows/update-readme.yml).
// No dependencies — Node 20+ (built-in fetch).
//
//   GITHUB_TOKEN=xxx node scripts/generate.mjs           -> fetch live data
//   node scripts/generate.mjs --mock scripts/mock.json   -> test with sample data

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

// ─────────────────────────── CONFIG (edit me) ───────────────────────────
const CONFIG = {
  login: "Adarsh812793",
  displayName: "Adarsh A Ladwa",          // shown big on the hero card
  role: "Full-stack developer · CS student",
  tagline: "Building things, breaking them, figuring out why.",
  featured: [],                           // e.g. ["TradeOS","AirbnbClone"]; empty = 4 newest repos
  exclude: ["Adarsh812793"],              // repos to hide from project cards
  outDir: "assets/generated",
  readme: "README.md",
};
// ────────────────────────────────────────────────────────────────────────

const C = {
  bg: "#0a0e1a", panel: "#0f1524", grid: "#1a2236", line: "#2a3550",
  text: "#e6edf7", dim: "#8a96b0", faint: "#55617a",
  accent: "#e3d26f", cyan: "#5ee6eb", violet: "#8f7cf7", green: "#3ddc84",
};
const MONO = `ui-monospace, 'SFMono-Regular', 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace`;

const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const trunc = (s = "", n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const fmt = (n) => Number(n).toLocaleString("en-US");
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const shortDate = (iso) => { const d = new Date(iso); return `${String(d.getUTCDate()).padStart(2, "0")} / ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

// ─────────────────────────── DATA ───────────────────────────
const QUERY = `query($login:String!){
  user(login:$login){
    name login bio
    followers{totalCount}
    allRepos: repositories(privacy:PUBLIC){totalCount}
    repositories(first:100, privacy:PUBLIC, ownerAffiliations:OWNER, isFork:false,
                 orderBy:{field:CREATED_AT, direction:DESC}){
      nodes{
        name description url stargazerCount createdAt pushedAt
        primaryLanguage{name color}
        languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{name color} } }
      }
    }
    contributionsCollection{
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
    }
  }
}`;

async function fetchLive() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Set GITHUB_TOKEN (or GH_TOKEN) to fetch live data.");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "readme-generator" },
    body: JSON.stringify({ query: QUERY, variables: { login: CONFIG.login } }),
  });
  const json = await res.json();
  if (json.errors || !json.data?.user) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user;
}

function shape(u) {
  const repos = u.repositories.nodes;
  const stars = repos.reduce((a, r) => a + r.stargazerCount, 0);

  const days = u.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  const today = new Date().toISOString().slice(0, 10);
  const past = days.filter((d) => d.date <= today);
  let current = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    if (past[i].contributionCount > 0) current++;
    else if (i === past.length - 1) continue; // today not yet active doesn't break the streak
    else break;
  }
  let longest = 0, run = 0;
  for (const d of past) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  const active = past.filter((d) => d.contributionCount > 0).length;

  const langMap = {};
  for (const r of repos) for (const e of r.languages.edges) {
    langMap[e.node.name] ??= { name: e.node.name, color: e.node.color || C.dim, size: 0 };
    langMap[e.node.name].size += e.size;
  }
  const totalSize = Object.values(langMap).reduce((a, l) => a + l.size, 0) || 1;
  const languages = Object.values(langMap).sort((a, b) => b.size - a.size)
    .map((l) => ({ ...l, pct: (l.size / totalSize) * 100 }));

  const visible = repos.filter((r) => !CONFIG.exclude.map((x) => x.toLowerCase()).includes(r.name.toLowerCase()));
  const featured = CONFIG.featured.length
    ? CONFIG.featured.map((n) => visible.find((r) => r.name.toLowerCase() === n.toLowerCase())).filter(Boolean)
    : visible.slice(0, 4);

  return {
    login: u.login, name: u.name, followers: u.followers.totalCount, repoCount: u.allRepos.totalCount,
    stars, total: u.contributionsCollection.contributionCalendar.totalContributions,
    weeks: u.contributionsCollection.contributionCalendar.weeks, current, longest, active,
    languages, featured: [...featured].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

// ─────────────────────────── SVG PARTS ───────────────────────────
const frame = (w, h, body, extraCss = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${MONO}">
<style>
  @keyframes fade{from{opacity:0}to{opacity:1}}
  @keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes type{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
  @keyframes blink{50%{opacity:0}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes spinr{to{transform:rotate(-360deg)}}
  @keyframes pulse{0%{r:9;opacity:.7}100%{r:22;opacity:0}}
  @keyframes dash{to{stroke-dashoffset:-60}}
  @keyframes twinkle{0%,100%{opacity:var(--o)}50%{opacity:1}}
  @keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .a{opacity:0;animation:fade .5s ease forwards}
  .u{opacity:0;animation:up .6s ease forwards;transform-box:fill-box}
  ${extraCss}
</style>
<defs>
  <pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${C.grid}" stroke-width=".6"/></pattern>
  <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${C.accent}" stop-opacity=".18"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></radialGradient>
  <linearGradient id="nameg" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient>
</defs>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="16" fill="${C.bg}" stroke="${C.line}"/>
<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="16" fill="url(#g)" opacity=".55"/>
${body}
</svg>`;

const eyebrow = (x, y, t) => `<text x="${x}" y="${y}" fill="${C.dim}" font-size="10.5" letter-spacing="2.2">${esc(t.toUpperCase())}</text>`;

function heroSVG(d) {
  const W = 900, H = 430;
  const boot = [
    [C.dim, `$ ssh ${d.login.toLowerCase()}@github.com`],
    [C.green, `[ OK ] mounted ${d.repoCount} repositories`],
    [C.green, `[ OK ] synced ${fmt(d.total)} contributions (last 12 months)`],
    [C.green, `[ OK ] ${d.followers} followers online · ${d.stars} stars`],
    [C.accent, `> boot complete. hello, world. i'm`],
  ];
  const lines = boot.map(([col, t], i) => {
    const delay = 0.3 + i * 0.55;
    return `<text x="40" y="${84 + i * 20}" fill="${col}" font-size="12.5" style="clip-path:inset(0 100% 0 0);animation:type .5s steps(${Math.max(12, t.length)}) ${delay}s forwards">${esc(t)}</text>`;
  }).join("\n");

  const nameDelay = 0.3 + boot.length * 0.55 + 0.1;
  const name = esc(CONFIG.displayName);
  const nameW = CONFIG.displayName.length * 26.2; // ~0.6em @ 42px + letter-spacing
  const cursorX = 40 + Math.min(nameW, 480) + 8;

  // orbit with top languages
  const cx = 720, cy = 205;
  const langs = d.languages.slice(0, 4);
  const radii = [50, 76, 102, 128];
  const orbits = radii.map((r, i) => {
    const l = langs[i];
    const dur = 14 + i * 7;
    const dot = l ? `<g style="transform-origin:${cx}px ${cy}px;animation:${i % 2 ? "spinr" : "spin"} ${dur}s linear infinite;animation-delay:-${i * 3}s">
      <circle cx="${cx + r}" cy="${cy}" r="${7 - i}" fill="${l.color}"/><circle cx="${cx + r}" cy="${cy}" r="${13 - i}" fill="${l.color}" opacity=".18"/></g>` : "";
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${i % 2 ? C.violet : C.line}" stroke-opacity="${i % 2 ? .5 : 1}" stroke-dasharray="${i % 2 ? "3 6" : "1 0"}"/>${dot}`;
  }).join("\n");
  const legend = langs.map((l, i) => `<g class="a" style="animation-delay:${nameDelay + 0.4 + i * 0.15}s"><circle cx="${600 + (i % 2) * 120}" cy="${372 + Math.floor(i / 2) * 18 - 4}" r="4" fill="${l.color}"/><text x="${610 + (i % 2) * 120}" y="${372 + Math.floor(i / 2) * 18}" fill="${C.dim}" font-size="11">${esc(trunc(l.name, 12))} ${l.pct.toFixed(0)}%</text></g>`).join("");

  const stats = [["Repositories", d.repoCount], ["Stars", d.stars], ["Contributions", d.total], ["Followers", d.followers]];
  const statEls = stats.map(([k, v], i) => {
    const x = 40 + i * 130;
    return `<g class="u" style="animation-delay:${nameDelay + 0.5 + i * 0.12}s">
      <text x="${x}" y="368" fill="${C.faint}" font-size="9.5" letter-spacing="1.8">${k.toUpperCase()}</text>
      <text x="${x}" y="396" fill="${C.text}" font-size="24" font-weight="600">${fmt(v)}</text></g>`;
  }).join("\n");

  const body = `
<!-- title bar -->
<circle cx="28" cy="26" r="5.5" fill="#ff5f57"/><circle cx="46" cy="26" r="5.5" fill="#febc2e"/><circle cx="64" cy="26" r="5.5" fill="#28c840"/>
<text x="${W / 2}" y="30" text-anchor="middle" fill="${C.dim}" font-size="11.5">${esc(d.login.toLowerCase())}@github: ~ — live</text>
<text x="${W - 28}" y="30" text-anchor="end" fill="${C.faint}" font-size="10.5">@${esc(d.login)}</text>
<line x1="1" y1="48" x2="${W - 1}" y2="48" stroke="${C.line}"/>

${lines}

<g class="u" style="animation-delay:${nameDelay}s">
  <text x="40" y="232" fill="url(#nameg)" font-size="42" font-weight="700" letter-spacing="1">${name}</text>
  <rect x="${cursorX}" y="200" width="18" height="38" fill="${C.accent}" style="animation:blink 1s step-end infinite"/>
</g>
<text class="a" x="40" y="266" fill="${C.text}" font-size="14" style="animation-delay:${nameDelay + 0.25}s">${esc(CONFIG.role)}</text>
<text class="a" x="40" y="290" fill="${C.dim}" font-size="12" style="animation-delay:${nameDelay + 0.35}s">${esc(CONFIG.tagline)}</text>

<line x1="40" y1="330" x2="560" y2="330" stroke="${C.line}"/>
${statEls}

<!-- orbit -->
<circle cx="${cx}" cy="${cy}" r="150" fill="url(#glow)"/>
${orbits}
<circle cx="${cx}" cy="${cy}" r="26" fill="${C.panel}" stroke="${C.accent}" stroke-opacity=".6"/>
<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${C.accent}" font-size="11" font-weight="700">&lt;/&gt;</text>
${legend}
<text x="${W - 22}" y="${H - 14}" text-anchor="end" fill="${C.faint}" font-size="9">updated ${new Date().toISOString().slice(0, 10)}</text>`;
  return frame(W, H, body);
}

function timelineSVG(d) {
  const W = 900, H = 330, y = 192, x0 = 140, x1 = W - 140;
  const items = d.featured;
  const n = items.length;
  const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
  const nodes = items.map((r, i) => {
    const x = n > 1 ? x0 + i * step : W / 2;
    const up = i % 2 === 0;
    const col = r.primaryLanguage?.color || C.violet;
    const lang = r.primaryLanguage?.name || "Code";
    const ty = up ? y - 82 : y + 44;
    const delay = 0.4 + i * 0.35;
    return `<g class="u" style="animation-delay:${delay}s">
  <circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${col}" style="animation:pulse 2.4s ease-out ${delay}s infinite"/>
  <circle cx="${x}" cy="${y}" r="13" fill="${C.bg}" stroke="${col}" stroke-width="1.5"/>
  <circle cx="${x}" cy="${y}" r="5" fill="${col}"/>
  <text x="${x}" y="${ty}" text-anchor="middle" fill="${C.faint}" font-size="10">${shortDate(r.createdAt)}</text>
  <text x="${x}" y="${ty + 20}" text-anchor="middle" fill="${C.text}" font-size="15" font-weight="600">${esc(trunc(r.name, 20))}</text>
  <text x="${x}" y="${ty + 38}" text-anchor="middle" fill="${C.dim}" font-size="10.5">${esc(trunc(r.description || "Public work in motion.", 30))}</text>
  <text x="${x}" y="${ty + 54}" text-anchor="middle" fill="${col}" font-size="10">${esc(lang)} · ★ ${r.stargazerCount}</text>
</g>`;
  }).join("\n");
  const body = `
${eyebrow(36, 40, "Project launch sequence")}
<text x="36" y="66" fill="${C.text}" font-size="19">Where the work went next</text>
<line x1="${x0 - 30}" y1="${y}" x2="${x1 + 30}" y2="${y}" stroke="${C.violet}" stroke-opacity=".55" stroke-dasharray="6 6" style="animation:dash 3s linear infinite"/>
<circle r="4" cy="${y}" fill="${C.cyan}"><animate attributeName="cx" values="${x0 - 30};${x1 + 30}" dur="6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;1;0" dur="6s" repeatCount="indefinite"/></circle>
${nodes}
<text x="36" y="${H - 18}" fill="${C.faint}" font-size="10">${n} featured repositories · oldest → newest</text>`;
  return frame(W, H, body);
}

function contribSVG(d) {
  const W = 900, H = 250;
  const weeks = d.weeks.slice(-53);
  const max = Math.max(1, ...weeks.flatMap((w) => w.contributionDays.map((x) => x.contributionCount)));
  const gx = 36, gy = 92, s = 15.6;
  let seed = 7; const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const dots = weeks.map((w, wi) => w.contributionDays.map((day) => {
    const dow = new Date(day.date + "T00:00:00Z").getUTCDay();
    const c = day.contributionCount;
    const x = (gx + wi * s + s / 2).toFixed(1), yy = (gy + dow * s + s / 2).toFixed(1);
    if (!c) return `<circle cx="${x}" cy="${yy}" r="1.3" fill="${C.line}"/>`;
    const t = Math.sqrt(c / max);
    const r = (2.2 + t * 4.2).toFixed(2);
    const col = t > 0.75 ? C.accent : t > 0.4 ? C.cyan : C.violet;
    const o = (0.45 + t * 0.4).toFixed(2);
    return `<circle cx="${x}" cy="${yy}" r="${r}" fill="${col}" style="--o:${o};opacity:${o};animation:twinkle ${(2 + rnd() * 3).toFixed(1)}s ease-in-out ${(rnd() * 3).toFixed(1)}s infinite"><title>${day.date}: ${c}</title></circle>`;
  }).join("")).join("\n");

  // month labels
  let last = -1;
  const months = weeks.map((w, wi) => {
    const m = new Date(w.contributionDays[0].date + "T00:00:00Z").getUTCMonth();
    if (m === last) return ""; last = m;
    return wi > 50 || wi < 2 ? "" : `<text x="${gx + wi * s + 2}" y="${gy - 8}" fill="${C.faint}" font-size="9">${MONTHS[m]}</text>`;
  }).join("");

  const body = `
${eyebrow(36, 40, "Contribution energy")}
<text x="36" y="64" fill="${C.text}" font-size="19">Every day leaves a trace</text>
${months}
${dots}
<text x="36" y="${H - 18}" fill="${C.dim}" font-size="11"><tspan fill="${C.text}" font-weight="600">${fmt(d.total)}</tspan> contributions · <tspan fill="${C.text}" font-weight="600">${d.current}</tspan> day streak · longest <tspan fill="${C.text}" font-weight="600">${d.longest}</tspan> · <tspan fill="${C.text}" font-weight="600">${d.active}</tspan> active days</text>
<g transform="translate(${W - 170} ${H - 22})"><text fill="${C.faint}" font-size="9" y="4">less</text>
${[[1.3, C.line], [2.6, C.violet], [4, C.cyan], [5.6, C.accent]].map(([r, c], i) => `<circle cx="${34 + i * 18}" cy="0" r="${r}" fill="${c}"/>`).join("")}
<text fill="${C.faint}" font-size="9" x="108" y="4">more</text></g>`;
  return frame(W, H, body);
}

function langSVG(d) {
  const W = 900, H = 200;
  const top = d.languages.slice(0, 6);
  const other = d.languages.slice(6).reduce((a, l) => a + l.pct, 0);
  if (other > 0.5) top.push({ name: "Other", color: C.faint, pct: other });
  const bx = 36, bw = W - 72, by = 92;
  let acc = 0;
  const segs = top.map((l, i) => {
    const w = (l.pct / 100) * bw;
    const el = `<rect x="${(bx + acc).toFixed(1)}" y="${by}" width="${Math.max(w - 2, 1).toFixed(1)}" height="12" rx="3" fill="${l.color}" style="transform-origin:${bx}px ${by}px;animation:grow 1.1s cubic-bezier(.2,.8,.2,1) ${0.2 + i * 0.08}s both"/>`;
    acc += w; return el;
  }).join("");
  const legend = top.map((l, i) => {
    const x = bx + (i % 4) * 210, y = 140 + Math.floor(i / 4) * 26;
    return `<g class="a" style="animation-delay:${0.6 + i * 0.1}s"><circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${l.color}"/><text x="${x + 18}" y="${y}" fill="${C.text}" font-size="12.5">${esc(l.name)}</text><text x="${x + 18 + l.name.length * 7.6 + 8}" y="${y}" fill="${C.dim}" font-size="12">${l.pct.toFixed(1)}%</text></g>`;
  }).join("");
  const body = `
${eyebrow(36, 40, "Language signal")}
<text x="36" y="64" fill="${C.text}" font-size="19">What the code is made of</text>
<rect x="${bx}" y="${by}" width="${bw}" height="12" rx="4" fill="${C.panel}"/>
${segs}
${legend}`;
  return frame(W, H, body);
}

// ─────────────────────────── README SECTIONS ───────────────────────────
function projectsTable(d) {
  const cells = d.featured.slice().reverse().map((r) => {
    const lang = r.primaryLanguage?.name || "Code";
    return `<td width="25%" valign="top">
<a href="${r.url}"><b>${esc(r.name)}</b></a><br>
<sub>${esc(r.description || "Public work in motion.")}</sub><br><br>
<code>${esc(lang)}</code> ★ ${r.stargazerCount}
</td>`;
  }).join("\n");
  return `<table>\n<tr>\n${cells}\n</tr>\n</table>`;
}

function replaceBlock(md, key, content) {
  const re = new RegExp(`(<!-- ${key}:START -->)[\\s\\S]*?(<!-- ${key}:END -->)`);
  return re.test(md) ? md.replace(re, `$1\n${content}\n$2`) : md;
}

// ─────────────────────────── MAIN ───────────────────────────
const mockIdx = process.argv.indexOf("--mock");
const raw = mockIdx > -1 ? JSON.parse(readFileSync(process.argv[mockIdx + 1], "utf8")) : await fetchLive();
const data = shape(raw);

mkdirSync(CONFIG.outDir, { recursive: true });
writeFileSync(`${CONFIG.outDir}/hero.svg`, heroSVG(data));
writeFileSync(`${CONFIG.outDir}/projects.svg`, timelineSVG(data));
writeFileSync(`${CONFIG.outDir}/contributions.svg`, contribSVG(data));
writeFileSync(`${CONFIG.outDir}/languages.svg`, langSVG(data));

if (existsSync(CONFIG.readme)) {
  let md = readFileSync(CONFIG.readme, "utf8");
  md = replaceBlock(md, "PROJECTS", projectsTable(data));
  md = replaceBlock(md, "STREAK", `<p align="center"><sub>🔥 ${data.current} day current streak · ${data.active} active days · ${fmt(data.total)} contributions this year</sub></p>`);
  writeFileSync(CONFIG.readme, md);
}
console.log(`✓ ${data.repoCount} repos · ${data.stars} stars · ${data.total} contributions · ${data.followers} followers`);
