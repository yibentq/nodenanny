'use strict';

// Wiki 百科模块（交接文档v4之后新增的第二条线，专门对应"知识传播"这部分需求）。
//
// 跟 kb-manager.js 的关系必须先说清楚，否则容易混：
// - kb-manager.js 管的是"日志匹配 -> 一键修复命令"这条给终端用的知识库，条目短、
//   面向"出问题了怎么办"，数据在 data/knowledge-base.json。
// - wiki-manager.js（这个文件）管的是"给萌新/小白看的百科文章"，条目长、面向
//   "这个概念是什么、这类服务怎么分类、这个项目怎么用"，数据在 data/wiki/ 目录下的
//   markdown 文件。两者只有一个可选的软关联：wiki页面的 frontmatter 里可以写
//   kbRef 指向某个 knowledge-base 条目的 id，前端渲染时给一个"查看一键修复"跳转链接，
//   除此之外数据互相独立，wiki 页面本身不具备执行命令的能力。
//
// 内容来源三块（对应交接文档里创始人说的三个核心）：
//   data/wiki/01-airports-and-vpn/     机场与VPN百科（创始人自己提供教程内容）
//   data/wiki/02-nodenanny-guide/      NodeNanny项目介绍与使用教程（这边整理，含一键修复引用）
//   data/wiki/03-network-knowledge/    节点/代理协议行业通识（这边联网调研整理）
// 文件夹前面的数字前缀只决定分类展示顺序，不参与实际路由（categoryId 是去掉数字前缀
// 之后的部分，比如 "01-airports-and-vpn" 对应的 categoryId 是 "airports-and-vpn"）。
//
// 安全设计要点（这块内容大量来自创始人从第三方机场网站复制粘贴的教程原文，必须当成
// "不完全可信的输入"来处理，不能假设内容干净）：
// 1. 本模块只返回原始 markdown 文本（+ 解析出的 frontmatter 元数据），从不在服务端
//    拼接/渲染成 HTML，也从不 eval 或执行 frontmatter 里的任何字段。
// 2. 真正的 markdown -> HTML 渲染放在前端（wiki.html 里用 marked.js + DOMPurify），
//    这样即使某条第三方教程原文里混进了 <script> 之类的内容，也会在渲染前被
//    DOMPurify 清洗掉，服务端这一层不需要、也不应该做HTML转义之外的事。
// 3. categoryId / slug 一律做白名单校验（只允许字母数字下划线短横线），防止路径穿越
//    读到 data/wiki 目录以外的文件。

const fs = require('fs');
const path = require('path');

const WIKI_DIR = path.join(__dirname, '..', 'data', 'wiki');
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

// ---------- 多语言支持（本轮新增） ----------
// 命名约定：默认（中文）文件是 slug.md，其它语言是 slug.<lang>.md（比如 glossary.en.md）。
// 分类说明同理：_category.json 是默认（中文），_category.<lang>.json 是其它语言。
// 缺失某语言译文时，一律安静地回退到中文原文，不报错、不返回空——调用方通过返回结果里
// 的 lang 字段（实际提供的语言）与 requestedLang（请求的语言）是否一致，判断要不要在
// 界面上提示"这篇文章还没有译文，以下是中文原文"。
const SUPPORTED_LANGS = ['zh', 'en', 'ja', 'de', 'ru'];

function normalizeLang(lang) {
  return typeof lang === 'string' && SUPPORTED_LANGS.includes(lang) ? lang : 'zh';
}


// 极简 frontmatter 解析：只支持 "---\nkey: value\n---\n正文" 这种最常见形式，
// value 两侧的引号会被去掉；tags 字段支持 "[a, b, c]" 或 "a, b, c" 两种写法。
// 不引入 yaml 依赖库——项目原有"能不加依赖就不加"的原则，这块格式简单，手写解析
// 够用，没必要为了一个平铺的 key:value 结构去装一整个 yaml parser。
function parseFrontmatter(raw) {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { meta: {}, content: raw };
  }
  const [, fmBlock, content] = fmMatch;
  const meta = {};
  fmBlock.split(/\r?\n/).forEach((line) => {
    const kv = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!kv) return;
    const key = kv[1];
    let value = kv[2].trim();
    if (key === 'tags') {
      const inner = value.replace(/^\[/, '').replace(/\]$/, '');
      meta.tags = inner
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
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

function isSafeId(id) {
  return typeof id === 'string' && SAFE_ID_RE.test(id);
}

// 分类文件夹名形如 "01-airports-and-vpn"，展示用 categoryId 去掉数字前缀。
function stripOrderPrefix(dirName) {
  return dirName.replace(/^\d+-/, '');
}

// lang 非空且非'zh'时，先找 _category.<lang>.json；不存在或解析失败，回退到默认的 _category.json。
function readCategoryMeta(categoryDirAbs, fallbackId, lang) {
  const normalizedLang = normalizeLang(lang);
  if (normalizedLang !== 'zh') {
    const localizedMetaPath = path.join(categoryDirAbs, `_category.${normalizedLang}.json`);
    if (fs.existsSync(localizedMetaPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(localizedMetaPath, 'utf-8'));
        return { title: parsed.title || fallbackId, description: parsed.description || '' };
      } catch (err) {
        console.error(`[wiki] ${localizedMetaPath} 解析失败，回退到默认 _category.json：${err.message}`);
      }
    }
  }
  const metaPath = path.join(categoryDirAbs, '_category.json');
  if (fs.existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      return { title: parsed.title || fallbackId, description: parsed.description || '' };
    } catch (err) {
      console.error(`[wiki] ${metaPath} 解析失败，用文件夹名兜底：${err.message}`);
    }
  }
  return { title: fallbackId, description: '' };
}

function listCategoryDirs() {
  if (!fs.existsSync(WIKI_DIR)) return [];
  return fs
    .readdirSync(WIKI_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(); // 靠数字前缀天然排序，"01-xxx" 在 "02-xxx" 前面
}

// 只列出"默认（中文）"页面文件，即文件名形如 slug.md（不含语言后缀）。
// 形如 slug.en.md 这样带语言后缀的文件不会被当成独立页面列出——它们只是
// slug.md 这篇文章的译文，通过 readPageRaw() 按需读取，不参与导航树/搜索的
// 文章计数。正则要求文件名本身（去掉 .md 后）不能再包含点号，这样能跟
// "slug.en.md"（两个点）区分开。
const BASE_PAGE_FILE_RE = /^[a-zA-Z0-9_-]+\.md$/;

function listPageFiles(categoryDirAbs) {
  if (!fs.existsSync(categoryDirAbs)) return [];
  return fs
    .readdirSync(categoryDirAbs, { withFileTypes: true })
    .filter((d) => d.isFile() && BASE_PAGE_FILE_RE.test(d.name))
    .map((d) => d.name);
}

// 按语言取一篇文章的原始 markdown 文本。lang 非'zh'时优先找 slug.<lang>.md，
// 找不到就安静回退到默认的 slug.md（中文）。返回 null 表示这篇文章（中文原文）
// 本身就不存在——这种情况下不存在"回退"的说法，直接判定整篇文章不存在。
function readPageRaw(categoryDirAbs, slug, lang) {
  const normalizedLang = normalizeLang(lang);
  if (normalizedLang !== 'zh') {
    const localizedPath = path.join(categoryDirAbs, `${slug}.${normalizedLang}.md`);
    if (fs.existsSync(localizedPath)) {
      return { raw: fs.readFileSync(localizedPath, 'utf-8'), servedLang: normalizedLang };
    }
  }
  const defaultPath = path.join(categoryDirAbs, `${slug}.md`);
  if (!fs.existsSync(defaultPath)) return null;
  return { raw: fs.readFileSync(defaultPath, 'utf-8'), servedLang: 'zh' };
}

// 构建整棵分类树，供左侧导航栏渲染用。每页只带轻量元信息（标题/摘要/更新时间），
// 不含正文，正文按需通过 getPage() 单独取，避免树请求把所有文章内容一次性传过去。
function buildTree(lang) {
  const normalizedLang = normalizeLang(lang);
  return listCategoryDirs().map((dirName) => {
    const categoryId = stripOrderPrefix(dirName);
    const categoryDirAbs = path.join(WIKI_DIR, dirName);
    const { title, description } = readCategoryMeta(categoryDirAbs, categoryId, normalizedLang);
    const pages = listPageFiles(categoryDirAbs)
      .map((fileName) => {
        const slug = fileName.replace(/\.md$/, '');
        const picked = readPageRaw(categoryDirAbs, slug, normalizedLang);
        if (!picked) return null; // 理论上不会发生（fileName本身就是从磁盘列出来的），防御性跳过
        const { meta } = parseFrontmatter(picked.raw);
        return {
          slug,
          title: meta.title || slug,
          summary: meta.summary || '',
          order: meta.order || 0,
          updated: meta.updated || '',
          tags: meta.tags || [],
          available: picked.servedLang === normalizedLang, // false=该语言暂无译文,当前展示的是中文标题
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title, 'zh'));
    return { categoryId, title, description, pages };
  });
}

// 取单篇文章的完整内容（原始 markdown，不做任何 HTML 转换）。
// lang：请求的语言（zh/en/ja/de/ru），非法或缺省按'zh'处理。返回结果里的 lang 字段是
// 实际提供的语言，requestedLang 是请求的语言——两者不一致时说明这篇文章还没有对应
// 语言的译文，是安静回退到中文原文的结果，前端据此决定要不要展示"暂无译文"的提示。
function getPage(categoryId, slug, lang) {
  if (!isSafeId(categoryId) || !isSafeId(slug)) {
    return null;
  }
  const normalizedLang = normalizeLang(lang);
  const dirName = listCategoryDirs().find((d) => stripOrderPrefix(d) === categoryId);
  if (!dirName) return null;
  const categoryDirAbs = path.join(WIKI_DIR, dirName);
  // path.join 已经规范化过，这里再显式确认结果仍在 WIKI_DIR 内，双重防护路径穿越
  // （isSafeId 已经把 categoryId/slug 限制在字母数字下划线短横线范围内，这里是双保险）
  if (!categoryDirAbs.startsWith(WIKI_DIR)) return null;
  const picked = readPageRaw(categoryDirAbs, slug, normalizedLang);
  if (!picked) return null;
  const { meta, content } = parseFrontmatter(picked.raw);
  return {
    categoryId,
    slug,
    title: meta.title || slug,
    summary: meta.summary || '',
    updated: meta.updated || '',
    tags: meta.tags || [],
    kbRef: meta.kbRef || null, // 可选：关联的一键修复知识库条目id，前端据此渲染跳转按钮
    content,
    lang: picked.servedLang,
    requestedLang: normalizedLang,
    available: picked.servedLang === normalizedLang,
  };
}

// 朴素全文检索：中文场景下按单词边界分词没有意义，直接用子串匹配（大小写不敏感）。
// 标题命中 > 摘要命中 > 正文命中，用于排序；正文命中额外截取匹配点附近文本作为
// 摘要片段（snippet），方便用户在搜索结果列表里判断是不是想找的那篇。
function search(query, lang) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const normalizedLang = normalizeLang(lang);
  const results = [];
  listCategoryDirs().forEach((dirName) => {
    const categoryId = stripOrderPrefix(dirName);
    const categoryDirAbs = path.join(WIKI_DIR, dirName);
    const { title: categoryTitle } = readCategoryMeta(categoryDirAbs, categoryId, normalizedLang);
    listPageFiles(categoryDirAbs).forEach((fileName) => {
      const slug = fileName.replace(/\.md$/, '');
      const picked = readPageRaw(categoryDirAbs, slug, normalizedLang);
      if (!picked) return;
      const { meta, content } = parseFrontmatter(picked.raw);
      const title = meta.title || slug;
      const summary = meta.summary || '';
      const lowerTitle = title.toLowerCase();
      const lowerSummary = summary.toLowerCase();
      const lowerContent = content.toLowerCase();

      let score = 0;
      let snippet = summary;
      if (lowerTitle.includes(q)) score = 3;
      else if (lowerSummary.includes(q)) score = 2;
      else if (lowerContent.includes(q)) {
        score = 1;
        const idx = lowerContent.indexOf(q);
        const start = Math.max(0, idx - 30);
        const end = Math.min(content.length, idx + q.length + 30);
        snippet = `...${content.slice(start, end).replace(/\s+/g, ' ')}...`;
      }
      if (score > 0) {
        results.push({ categoryId, categoryTitle, slug, title, summary: snippet, score });
      }
    });
  });
  return results.sort((a, b) => b.score - a.score).slice(0, 30);
}

module.exports = { buildTree, getPage, search, parseFrontmatter, isSafeId, SUPPORTED_LANGS, normalizeLang };
