'use strict';

const assert = require('assert');
const wiki = require('./core/wiki-manager');

let passed = 0;
let failed = 0;
function check(desc, fn) {
  try {
    fn();
    console.log(`[OK] ${desc}`);
    passed++;
  } catch (err) {
    console.log(`[FAIL] ${desc}: ${err.message}`);
    failed++;
  }
}

// ---------- frontmatter 解析 ----------
check('parseFrontmatter 正确切分 meta 和正文', () => {
  const raw = '---\ntitle: 测试标题\norder: 2\ntags: [a, b, c]\n---\n正文第一行\n正文第二行';
  const { meta, content } = wiki.parseFrontmatter(raw);
  assert.strictEqual(meta.title, '测试标题');
  assert.strictEqual(meta.order, 2);
  assert.deepStrictEqual(meta.tags, ['a', 'b', 'c']);
  assert.strictEqual(content, '正文第一行\n正文第二行');
});

check('没有frontmatter时,content就是原文,meta是空对象', () => {
  const raw = '没有frontmatter的纯文本';
  const { meta, content } = wiki.parseFrontmatter(raw);
  assert.deepStrictEqual(meta, {});
  assert.strictEqual(content, raw);
});

// ---------- 分类树 ----------
check('buildTree能读到4个分类,且按文件夹数字前缀排序', () => {
  const tree = wiki.buildTree();
  assert.strictEqual(tree.length, 4);
  assert.strictEqual(tree[0].categoryId, 'airports-and-vpn');
  assert.strictEqual(tree[1].categoryId, 'nodenanny-guide');
  assert.strictEqual(tree[2].categoryId, 'network-knowledge');
  assert.strictEqual(tree[3].categoryId, 'compliance-and-risk');
});

check('每个分类都有_category.json里定义的title', () => {
  const tree = wiki.buildTree();
  assert.strictEqual(tree[0].title, '机场与VPN百科');
  assert.strictEqual(tree[1].title, 'NodeNanny 项目介绍与使用教程');
});

check('nodenanny-guide分类下的页面按order排序,故障排查页在教程页后面', () => {
  const tree = wiki.buildTree();
  const guide = tree.find((c) => c.categoryId === 'nodenanny-guide');
  const slugs = guide.pages.map((p) => p.slug);
  assert.strictEqual(slugs[0], 'overview');
  assert.strictEqual(slugs[1], 'installation');
  assert.strictEqual(slugs[2], 'daily-use');
  assert.ok(slugs.indexOf('ts-vmess-rename') > slugs.indexOf('daily-use'));
});

// ---------- 单页获取 ----------
check('getPage能正确取到指定文章的完整内容和kbRef', () => {
  const page = wiki.getPage('nodenanny-guide', 'ts-iptables');
  assert.ok(page);
  assert.strictEqual(page.kbRef, 'iptables-blocking-port');
  assert.ok(page.content.includes('iptables -F'));
});

check('getPage对不存在的slug返回null', () => {
  assert.strictEqual(wiki.getPage('nodenanny-guide', 'does-not-exist'), null);
});

check('getPage对不合法的categoryId/slug直接拒绝(防路径穿越)', () => {
  assert.strictEqual(wiki.getPage('../../../etc', 'passwd'), null);
  assert.strictEqual(wiki.getPage('nodenanny-guide', '../../../../etc/passwd'), null);
  assert.strictEqual(wiki.getPage('nodenanny-guide', 'foo/bar'), null);
});

check('isSafeId正确区分合法与非法id', () => {
  assert.strictEqual(wiki.isSafeId('nodenanny-guide'), true);
  assert.strictEqual(wiki.isSafeId('../etc'), false);
  assert.strictEqual(wiki.isSafeId('a/b'), false);
});

// ---------- 搜索 ----------
check('搜索标题命中的排名高于正文/摘要命中', () => {
  // ts-vmess-rename标题里直接带"vmess"三个字,应该是score 3(标题命中);
  // 而ts-iptables的标题其实不含"iptables"这个词(只有摘要里有),之前这里的断言
  // 写错了预期值,不是wiki-manager.js的排序逻辑有问题——修正测试用例本身。
  const results = wiki.search('vmess');
  const titleHit = results.find((r) => r.slug === 'ts-vmess-rename');
  assert.ok(titleHit);
  assert.strictEqual(titleHit.score, 3);

  const summaryHit = wiki.search('connection refused').find((r) => r.slug === 'ts-iptables');
  assert.ok(summaryHit);
  assert.strictEqual(summaryHit.score, 2);
});

check('搜索能匹配到中文关键词', () => {
  const results = wiki.search('证书');
  assert.ok(results.some((r) => r.slug === 'ts-tls-cert'));
});

check('空查询返回空数组,不报错', () => {
  assert.deepStrictEqual(wiki.search(''), []);
  assert.deepStrictEqual(wiki.search('   '), []);
});

check('搜索不存在的关键词返回空数组', () => {
  assert.deepStrictEqual(wiki.search('这个词绝对不会出现在任何一篇文章里xyz123'), []);
});

// ---------- 多语言（本轮新增） ----------
check('getPage请求已有译文的语言(en),返回该语言内容,lang和requestedLang一致,available为true', () => {
  const page = wiki.getPage('airports-and-vpn', 'overview', 'en');
  assert.ok(page);
  assert.strictEqual(page.lang, 'en');
  assert.strictEqual(page.requestedLang, 'en');
  assert.strictEqual(page.available, true);
  assert.ok(page.title.includes('Overview'));
  assert.ok(page.content.includes('Sub-pages'));
});

check('getPage请求已有译文的语言(ja),返回该语言内容,lang和requestedLang一致,available为true', () => {
  // 01-03分类全部四种语言(en/ja/de/ru)已经翻译完整(v27之后的批次),
  // 这条断言从"验证回退"改成"验证真译文命中",回退逻辑改用下面的独立fixture测试覆盖
  const page = wiki.getPage('airports-and-vpn', 'overview', 'ja');
  assert.ok(page);
  assert.strictEqual(page.lang, 'ja');
  assert.strictEqual(page.requestedLang, 'ja');
  assert.strictEqual(page.available, true);
});

check('getPage缺省lang参数按zh处理,行为跟历史上不传lang完全一致', () => {
  const page = wiki.getPage('airports-and-vpn', 'overview');
  assert.strictEqual(page.lang, 'zh');
  assert.strictEqual(page.requestedLang, 'zh');
  assert.strictEqual(page.available, true);
});

check('getPage对非法/不支持的lang值(比如fr)按zh兜底,不报错', () => {
  const page = wiki.getPage('airports-and-vpn', 'overview', 'fr');
  assert.strictEqual(page.lang, 'zh');
  assert.strictEqual(page.requestedLang, 'zh');
});

check('buildTree(en)对已有英文译文的页面显示英文标题,available为true', () => {
  // glossary.en.md现已存在(v27之后的批次补齐),这条断言从"验证回退"改成"验证真译文命中"
  const tree = wiki.buildTree('en');
  const cat = tree.find((c) => c.categoryId === 'airports-and-vpn');
  const overviewPage = cat.pages.find((p) => p.slug === 'overview');
  assert.ok(overviewPage.title.includes('Overview'));
  assert.strictEqual(overviewPage.available, true);
  const glossaryPage = cat.pages.find((p) => p.slug === 'glossary');
  assert.ok(glossaryPage.title.toLowerCase().includes('glossary'));
  assert.strictEqual(glossaryPage.available, true);
});

check('buildTree(en)对已有英文分类说明(_category.en.json)的分类,显示英文分类标题', () => {
  const tree = wiki.buildTree('en');
  const cat = tree.find((c) => c.categoryId === 'airports-and-vpn');
  assert.strictEqual(cat.title, 'Airports & VPN Wiki');
});

check('buildTree(en)对已有_category.en.json的nodenanny-guide分类,显示英文分类标题', () => {
  // _category.en.json现已存在(v27之后的批次补齐),这条断言从"验证回退"改成"验证真译文命中"
  const tree = wiki.buildTree('en');
  const cat = tree.find((c) => c.categoryId === 'nodenanny-guide');
  assert.strictEqual(cat.title, 'NodeNanny: Project Overview & User Guide');
});

check('buildTree不传lang时行为不变,等价于中文', () => {
  const tree = wiki.buildTree();
  const cat = tree.find((c) => c.categoryId === 'airports-and-vpn');
  assert.strictEqual(cat.title, '机场与VPN百科');
  const overviewPage = cat.pages.find((p) => p.slug === 'overview');
  assert.strictEqual(overviewPage.title, '机场与VPN百科·总览');
});

check('search(query, en)在英文正文里搜索命中', () => {
  // ts-tls-cert.en.md现已存在(v27之后的批次补齐),用certificate(英文译文里的词)验证能搜到英文正文
  const enResults = wiki.search('red flags', 'en');
  assert.ok(enResults.some((r) => r.slug === 'overview' && r.categoryId === 'airports-and-vpn'));

  const certResults = wiki.search('certificate', 'en');
  assert.ok(certResults.some((r) => r.slug === 'ts-tls-cert'));
});

check('listPageFiles不会把xxx.en.md这样带语言后缀的文件误当成独立页面列出', () => {
  const tree = wiki.buildTree();
  const cat = tree.find((c) => c.categoryId === 'airports-and-vpn');
  const slugs = cat.pages.map((p) => p.slug);
  assert.strictEqual(slugs.filter((s) => s === 'overview').length, 1); // 不会因为多了overview.en.md变成2条
  assert.ok(!slugs.includes('overview.en')); // 不会把语言后缀当成slug的一部分
});

check('SUPPORTED_LANGS和normalizeLang按预期工作', () => {
  assert.deepStrictEqual(wiki.SUPPORTED_LANGS, ['zh', 'en', 'ja', 'de', 'ru']);
  assert.strictEqual(wiki.normalizeLang('en'), 'en');
  assert.strictEqual(wiki.normalizeLang('fr'), 'zh');
  assert.strictEqual(wiki.normalizeLang(undefined), 'zh');
  assert.strictEqual(wiki.normalizeLang(null), 'zh');
});

// ---------- 回退逻辑专项测试(独立fixture) ----------
// 说明:01/02/03三个分类目前四种语言(en/ja/de/ru)已经全部翻译完整,
// 真实data/wiki目录里已经找不到"有中文、没有译文"的反面案例了。
// 为了不让"没有译文时安静回退中文"这条核心逻辑失去测试覆盖,这里单独造一个
// 临时分类(只有中文文件,不带任何语言后缀文件),用完即删,不影响真实wiki数据。
{
  const path = require('path');
  const fs = require('fs');
  const fixtureCategoryDir = path.join(__dirname, 'data', 'wiki', '99-fallback-fixture-tmp');
  let fixtureCreated = false;
  try {
    fs.mkdirSync(fixtureCategoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(fixtureCategoryDir, '_category.json'),
      JSON.stringify({ title: '回退测试专用临时分类', description: '仅供test-wiki-manager.js使用' }, null, 2)
    );
    fs.writeFileSync(
      path.join(fixtureCategoryDir, 'only-zh.md'),
      '---\ntitle: 只有中文的测试页面\norder: 0\n---\n\n这篇文章故意不提供任何语言的译文,用来验证回退逻辑。'
    );
    fixtureCreated = true;

    // 必须重新require一次,因为wiki-manager内部可能有基于mtime的缓存
    delete require.cache[require.resolve('./core/wiki-manager')];
    const wikiFixture = require('./core/wiki-manager');

    // 分类文件夹名带数字前缀(如"99-fallback-fixture-tmp"),但buildTree/getPage对外
    // 暴露的categoryId是去掉前缀之后的部分(stripOrderPrefix),所以断言里用
    // "fallback-fixture-tmp",不带"99-"。
    check('getPage对没有任何译文的页面请求非中文语言,安静回退到中文,available为false', () => {
      const page = wikiFixture.getPage('fallback-fixture-tmp', 'only-zh', 'en');
      assert.ok(page);
      assert.strictEqual(page.lang, 'zh');
      assert.strictEqual(page.requestedLang, 'en');
      assert.strictEqual(page.available, false);
      assert.ok(page.title.includes('只有中文的测试页面'));
    });

    check('buildTree对没有_category.<lang>.json的分类,回退到中文分类标题', () => {
      const tree = wikiFixture.buildTree('en');
      const cat = tree.find((c) => c.categoryId === 'fallback-fixture-tmp');
      assert.ok(cat);
      assert.strictEqual(cat.title, '回退测试专用临时分类');
    });

    check('search(query, en)对没有译文的页面,回退到中文正文里搜索', () => {
      const fallbackResults = wikiFixture.search('故意不提供', 'en');
      assert.ok(fallbackResults.some((r) => r.slug === 'only-zh' && r.categoryId === 'fallback-fixture-tmp'));
    });
  } catch (err) {
    console.log(`[FAIL] 回退逻辑fixture测试搭建失败: ${err.message}`);
    failed++;
  } finally {
    if (fixtureCreated) {
      fs.rmSync(fixtureCategoryDir, { recursive: true, force: true });
    }
    // 清理完fixture后再删一次缓存,确保后面(如果有别的进程复用这个模块实例)不会持有脏状态
    delete require.cache[require.resolve('./core/wiki-manager')];
  }
}

console.log(`\n共 ${passed + failed} 项断言，通过 ${passed} 项，失败 ${failed} 项。`);
process.exit(failed > 0 ? 1 : 0);
