'use strict';

// build-wiki-site.js
// 把 data/wiki/ 下的中文(默认)+英文两种语言内容，构建成一套纯静态 HTML 站点，
// 用于发布到 GitHub Pages，方便公开搜索/AI 爬虫抓取。
//
// 不改动 data/wiki/ 本身，不影响面板内置 Wiki（那边继续保留 5 语言不变）。
// 这个脚本只在 GitHub Actions 里跑，跑完把 out/ 目录发布出去，源仓库不受影响。
//
// 用法： node build-wiki-site.js <repo-root> <output-dir>

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const [, , repoRootArg, outDirArg] = process.argv;
const REPO_ROOT = path.resolve(repoRootArg || '.');
const WIKI_DIR = path.join(REPO_ROOT, 'data', 'wiki');
const OUT_DIR = path.resolve(outDirArg || 'out');

const LANGS = ['zh', 'en']; // 只做中英文，其余语言(ja/de/ru)不生成静态页面
const SITE_TITLE = 'NodeNanny Wiki';
const REPO_URL = 'https://github.com/yibentq/nodenanny';

// ---------- 以下几个函数直接照搬 core/wiki-manager.js 里的规则，保证行为一致 ----------

function stripOrderPrefix(dirName) {
  return dirName.replace(/^\d+-/, '');
}

function parseFrontmatter(raw) {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) return { meta: {}, content: raw };
  const [, fmBlock, content] = fmMatch;
  const meta = {};
  fmBlock.split(/\r?\n/).forEach((line) => {
    const kv = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!kv) return;
    const key = kv[1];
    let value = kv[2].trim();
    if (key === 'tags') {
      const inner = value.replace(/^\[/, '').replace(/\]$/, '');
      meta.tags = inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      return;
    }
    value = value.replace(/^["']|["']$/g, '');
    if (key === 'order') {
      meta.order = Number(value) || 0;
      return;
    }
    meta[key] = value;
  });
  return { meta, content: content || '' };
}

function listCategoryDirs() {
  if (!fs.existsSync(WIKI_DIR)) return [];
  return fs.readdirSync(WIKI_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

const BASE_PAGE_FILE_RE = /^[a-zA-Z0-9_-]+\.md$/;

function listPageFiles(categoryDirAbs) {
  if (!fs.existsSync(categoryDirAbs)) return [];
  return fs.readdirSync(categoryDirAbs, { withFileTypes: true })
    .filter((d) => d.isFile() && BASE_PAGE_FILE_RE.test(d.name))
    .map((d) => d.name);
}

// 按语言读取一篇文章。lang='en'时优先找 slug.en.md，找不到就回退中文原文，
// 并标记 available=false（静态站上会显示"暂无英文翻译，以下为中文原文"提示）。
function readPageRaw(categoryDirAbs, slug, lang) {
  if (lang === 'en') {
    const localizedPath = path.join(categoryDirAbs, `${slug}.en.md`);
    if (fs.existsSync(localizedPath)) {
      return { raw: fs.readFileSync(localizedPath, 'utf-8'), servedLang: 'en' };
    }
  }
  const defaultPath = path.join(categoryDirAbs, `${slug}.md`);
  if (!fs.existsSync(defaultPath)) return null;
  return { raw: fs.readFileSync(defaultPath, 'utf-8'), servedLang: 'zh' };
}

function readCategoryMeta(categoryDirAbs, fallbackId, lang) {
  if (lang === 'en') {
    const localizedMetaPath = path.join(categoryDirAbs, '_category.en.json');
    if (fs.existsSync(localizedMetaPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(localizedMetaPath, 'utf-8'));
        return { title: parsed.title || fallbackId, description: parsed.description || '' };
      } catch (err) {
        console.error(`[build-wiki-site] ${localizedMetaPath} 解析失败: ${err.message}`);
      }
    }
  }
  const metaPath = path.join(categoryDirAbs, '_category.json');
  if (fs.existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      return { title: parsed.title || fallbackId, description: parsed.description || '' };
    } catch (err) {
      console.error(`[build-wiki-site] ${metaPath} 解析失败: ${err.message}`);
    }
  }
  return { title: fallbackId, description: '' };
}

// ---------- 内部链接重写：复刻 public/wiki.html 里 resolveInternalWikiLink() 的规则 ----------
// ./slug           -> 同分类下的另一篇文章
// ../01-xxx/slug   -> 跨分类链接，带数字前缀，需要去掉前缀

function resolveInternalWikiLink(href, currentCategoryId) {
  if (!href) return null;
  const p = href.split('#')[0].replace(/\.md$/i, '');
  if (!p) return null;
  if (p.startsWith('./')) {
    const slug = p.slice(2);
    return slug ? { categoryId: currentCategoryId, slug } : null;
  }
  if (p.startsWith('../')) {
    const rest = p.slice(3);
    const parts = rest.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const categoryId = parts[0].replace(/^\d+-/, '');
      return { categoryId, slug: parts.slice(1).join('/') };
    }
    return null;
  }
  return null;
}

function pageUrl(lang, categoryId, slug) {
  return `/wiki/${lang}/${categoryId}/${slug}.html`;
}

// 渲染前重写 markdown 里的内部链接为静态站真实相对路径，外部链接原样保留。
function rewriteMarkdownLinks(md, lang, currentCategoryId) {
  return md.replace(/\]\(([^)]+)\)/g, (whole, href) => {
    if (/^https?:\/\//i.test(href) || href.startsWith('#')) return whole;
    const target = resolveInternalWikiLink(href, currentCategoryId);
    if (!target) return whole;
    return `](${pageUrl(lang, target.categoryId, target.slug)})`;
  });
}

// ---------- HTML 输出 ----------

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const BASE_CSS = `
:root{color-scheme:light dark;--fg:#1a1a1a;--bg:#ffffff;--muted:#6b6b6b;--border:#e3e3e3;--accent:#2563eb;}
@media (prefers-color-scheme:dark){:root{--fg:#e8e8e8;--bg:#14161a;--muted:#9a9a9a;--border:#2a2d33;}}
*{box-sizing:border-box;}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg);line-height:1.7;}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:10px;}
.topbar a{color:var(--fg);text-decoration:none;font-weight:600;}
.langs a{margin-left:10px;color:var(--muted);text-decoration:none;font-size:14px;}
.langs a.active{color:var(--accent);font-weight:600;}
.layout{display:flex;max-width:1100px;margin:0 auto;padding:20px;gap:32px;}
@media (max-width:760px){.layout{flex-direction:column;padding:14px;}}
nav.sidebar{flex:0 0 240px;}
nav.sidebar h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:18px 0 8px;}
nav.sidebar ul{list-style:none;margin:0;padding:0;}
nav.sidebar li{margin:4px 0;}
nav.sidebar a{color:var(--fg);text-decoration:none;font-size:14px;}
nav.sidebar a:hover{color:var(--accent);}
main.content{flex:1;min-width:0;}
main.content h1{font-size:26px;margin-top:0;}
main.content code{background:rgba(127,127,127,.15);padding:2px 5px;border-radius:4px;font-size:0.92em;}
main.content pre{background:rgba(127,127,127,.12);padding:14px;border-radius:8px;overflow-x:auto;}
main.content pre code{background:none;padding:0;}
main.content a{color:var(--accent);}
.meta{color:var(--muted);font-size:13px;margin-bottom:20px;}
.notice{background:rgba(37,99,235,.1);border:1px solid rgba(37,99,235,.3);padding:10px 14px;border-radius:8px;font-size:14px;margin-bottom:20px;}
.footer{max-width:1100px;margin:0 auto;padding:20px;color:var(--muted);font-size:13px;border-top:1px solid var(--border);}
.cat-card{border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px;}
.cat-card h2{margin:0 0 6px;font-size:18px;}
.cat-card p{color:var(--muted);margin:0 0 10px;font-size:14px;}
`;

function langSwitchHtml(lang, altUrl, altAvailable) {
  const zhHref = lang === 'zh' ? '#' : altUrl;
  const enHref = lang === 'en' ? '#' : altUrl;
  return `<span class="langs">
    <a class="${lang === 'zh' ? 'active' : ''}" href="${lang === 'zh' ? '#' : (altAvailable ? altUrl : '#')}">中文</a>
    <a class="${lang === 'en' ? 'active' : ''}" href="${lang === 'en' ? '#' : (altAvailable ? altUrl : '#')}">EN</a>
  </span>`;
}

function renderSidebar(tree, lang, activeCategoryId, activeSlug) {
  return `<nav class="sidebar">` + tree.map((cat) => `
    <h3>${escapeHtml(cat.title)}</h3>
    <ul>${cat.pages.map((p) => `<li><a href="${pageUrl(lang, cat.categoryId, p.slug)}"${(cat.categoryId === activeCategoryId && p.slug === activeSlug) ? ' style="color:var(--accent);font-weight:600;"' : ''}>${escapeHtml(p.title)}</a></li>`).join('')}</ul>
  `).join('') + `</nav>`;
}

function pageShell({ lang, title, bodyHtml, sidebarHtml, altUrl, altAvailable }) {
  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${SITE_TITLE}</title>
<style>${BASE_CSS}</style>
</head>
<body>
<div class="topbar">
  <a href="/wiki/${lang}/index.html">${SITE_TITLE}</a>
  <div>
    ${langSwitchHtml(lang, altUrl, altAvailable)}
    <a href="${REPO_URL}" style="margin-left:16px;font-weight:400;color:var(--muted);">GitHub ↗</a>
  </div>
</div>
<div class="layout">
  ${sidebarHtml}
  <main class="content">${bodyHtml}</main>
</div>
<div class="footer">NodeNanny is MIT-licensed and free to self-host. <a href="${REPO_URL}">${REPO_URL}</a></div>
</body>
</html>`;
}

function build() {
  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const dirNames = listCategoryDirs();

  // 先按语言分别构建分类树（含每篇文章的元信息），供导航栏和索引页使用
  const trees = {};
  for (const lang of LANGS) {
    trees[lang] = dirNames.map((dirName) => {
      const categoryId = stripOrderPrefix(dirName);
      const categoryDirAbs = path.join(WIKI_DIR, dirName);
      const { title, description } = readCategoryMeta(categoryDirAbs, categoryId, lang);
      const pages = listPageFiles(categoryDirAbs).map((fileName) => {
        const slug = fileName.replace(/\.md$/, '');
        const picked = readPageRaw(categoryDirAbs, slug, lang);
        if (!picked) return null;
        const { meta } = parseFrontmatter(picked.raw);
        return {
          slug,
          title: meta.title || slug,
          summary: meta.summary || '',
          order: meta.order || 0,
          available: picked.servedLang === lang,
        };
      }).filter(Boolean).sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));
      return { categoryId, dirName, title, description, pages };
    });
  }

  let pageCount = 0;

  for (const lang of LANGS) {
    const otherLang = lang === 'zh' ? 'en' : 'zh';
    const tree = trees[lang];

    for (const cat of tree) {
      const categoryDirAbs = path.join(WIKI_DIR, cat.dirName);
      for (const pageMeta of cat.pages) {
        const picked = readPageRaw(categoryDirAbs, pageMeta.slug, lang);
        if (!picked) continue;
        const { meta, content } = parseFrontmatter(picked.raw);
        const rewrittenMd = rewriteMarkdownLinks(content, lang, cat.categoryId);
        const rawHtml = marked.parse(rewrittenMd);
        const safeHtml = sanitizeHtml(rawHtml, {
          allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'img']),
          allowedAttributes: {
            ...sanitizeHtml.defaults.allowedAttributes,
            img: ['src', 'alt'],
            a: ['href', 'name', 'target', 'rel'],
          },
        });

        const notice = picked.servedLang !== lang
          ? `<div class="notice">${lang === 'en' ? 'No English translation yet — showing the original Chinese content.' : '暂无该语言译文，以下为中文原文。'}</div>`
          : '';

        const title = meta.title || pageMeta.slug;
        const body = `<h1>${escapeHtml(title)}</h1>${meta.updated ? `<div class="meta">${lang === 'en' ? 'Updated' : '更新于'} ${escapeHtml(meta.updated)}</div>` : ''}${notice}${safeHtml}`;

        const altUrl = pageUrl(otherLang, cat.categoryId, pageMeta.slug);
        // 判断切换到另一种语言是否真的有对应文章（用另一语言的tree核对一下）
        const altAvailable = !!(trees[otherLang].find((c) => c.categoryId === cat.categoryId)?.pages.find((p) => p.slug === pageMeta.slug));

        const html = pageShell({
          lang,
          title,
          bodyHtml: body,
          sidebarHtml: renderSidebar(tree, lang, cat.categoryId, pageMeta.slug),
          altUrl,
          altAvailable,
        });

        const outPath = path.join(OUT_DIR, 'wiki', lang, cat.categoryId, `${pageMeta.slug}.html`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, html);
        pageCount++;
      }
    }

    // 每种语言的索引页：列出全部分类卡片
    const indexBody = tree.map((cat) => `
      <div class="cat-card">
        <h2>${escapeHtml(cat.title)}</h2>
        <p>${escapeHtml(cat.description)}</p>
        <ul>${cat.pages.map((p) => `<li><a href="${pageUrl(lang, cat.categoryId, p.slug)}">${escapeHtml(p.title)}</a></li>`).join('')}</ul>
      </div>`).join('');
    const indexHtml = pageShell({
      lang,
      title: lang === 'en' ? 'NodeNanny Wiki' : 'NodeNanny 百科',
      bodyHtml: `<h1>${lang === 'en' ? 'NodeNanny Wiki' : 'NodeNanny 百科'}</h1>${indexBody}`,
      sidebarHtml: renderSidebar(tree, lang, null, null),
      altUrl: `/wiki/${otherLang}/index.html`,
      altAvailable: true,
    });
    const indexPath = path.join(OUT_DIR, 'wiki', lang, 'index.html');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, indexHtml);
  }

  // 站点根目录 index.html：简单落地页，跳到中文索引（默认语言），同时给英文入口
  const rootIndex = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${SITE_TITLE}</title><style>${BASE_CSS}</style></head>
<body>
<div class="topbar"><a href="/wiki/zh/index.html">${SITE_TITLE}</a></div>
<div class="layout" style="flex-direction:column;">
  <main class="content">
    <h1>NodeNanny Wiki</h1>
    <p>NodeNanny is a post-deployment guardian for a single self-hosted proxy node — Xray / sing-box / v2ray / Shadowsocks / Trojan. This site mirrors the built-in wiki content (Chinese &amp; English) for public search.</p>
    <ul>
      <li><a href="/wiki/zh/index.html">中文百科 →</a></li>
      <li><a href="/wiki/en/index.html">English Wiki →</a></li>
      <li><a href="${REPO_URL}">GitHub Repository →</a></li>
    </ul>
  </main>
</div>
</body></html>`;
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), rootIndex);

  // .nojekyll：防止 GitHub Pages 用 Jekyll 处理（我们的输出目录里没有下划线开头的特殊文件问题，
  // 但保留这个是 GitHub Pages 纯静态站点的标准约定，避免任何潜在的 Jekyll 干扰）
  fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

  console.log(`[build-wiki-site] 完成，共生成 ${pageCount} 篇文章页 + ${LANGS.length} 个语言索引页。输出目录：${OUT_DIR}`);
}

build();
