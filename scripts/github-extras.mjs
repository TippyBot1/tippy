// Keeps the GitHub repo's extras in step with the code, after each push:
//   releases — one per version in CHANGELOG.md whose tag (v0.1.2…) is pushed
//   issues   — the roadmap in .github/roadmap.json: opened once (matched by
//              title), closed when an item is marked done, never reopened
//   topics   — what the repo is about, for GitHub search
// Run by publish-github.sh, which passes the token in GH_TOKEN. Nothing here
// prints the token.
//
//   GH_TOKEN=… node scripts/github-extras.mjs <owner> <repo>

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [owner, repo] = process.argv.slice(2);
const token = process.env.GH_TOKEN;
if (!owner || !repo || !token) {
  console.error('usage: GH_TOKEN=… node scripts/github-extras.mjs <owner> <repo>');
  process.exit(1);
}
const API = `https://api.github.com/repos/${owner}/${repo}`;

async function gh(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? {} : res.json();
}

// ---------- releases from CHANGELOG.md ----------
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
const sections = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\][^\n]*\n([\s\S]*?)(?=^## \[|(?![\s\S]))/gm)].map((m) => ({ version: m[1], notes: m[2].trim() }));
for (const [i, { version, notes }] of sections.entries()) {
  const tag = `v${version}`;
  if (!(await gh('GET', `/git/ref/tags/${tag}`))) continue; // not tagged (or tag not pushed) yet
  if (await gh('GET', `/releases/tags/${tag}`)) continue;
  await gh('POST', '/releases', { tag_name: tag, name: tag, body: notes, make_latest: i === 0 ? 'true' : 'false' });
  console.log(`✓ Release ${tag}`);
}

// ---------- roadmap issues ----------
const roadmap = JSON.parse(readFileSync(join(root, '.github/roadmap.json'), 'utf8'));
const COLORS = { roadmap: '5ee6b5', telegram: '2aabee', alerts: 'ffd166', orders: '6c5ce7', app: '8c9cff', website: 'f472b6', distribution: 'ffb547', trust: '2ec27e' };
for (const name of new Set(roadmap.flatMap((r) => r.labels))) {
  if (!(await gh('GET', `/labels/${encodeURIComponent(name)}`))) await gh('POST', '/labels', { name, color: COLORS[name] ?? 'cccccc' });
}
const existing = new Map();
for (let page = 1; ; page++) {
  const batch = (await gh('GET', `/issues?state=all&per_page=100&page=${page}`)) ?? [];
  for (const it of batch) if (!it.pull_request) existing.set(it.title, it);
  if (batch.length < 100) break;
}
for (const item of roadmap) {
  let issue = existing.get(item.title);
  if (!issue) {
    issue = await gh('POST', '/issues', { title: item.title, body: item.body, labels: item.labels });
    console.log(`✓ Opened: ${item.title}`);
  }
  if (item.state === 'closed' && issue.state === 'open') {
    await gh('PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
    console.log(`✓ Done: ${item.title}`);
  }
}

// ---------- topics ----------
await gh('PUT', '/topics', { names: ['chrome-extension', 'fomo', 'take-profit', 'stop-loss', 'limit-orders', 'telegram-bot', 'trading', 'typescript', 'preact', 'cloudflare-workers'] });
console.log('✓ Topics');
