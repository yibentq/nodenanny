'use strict';

// 批次三-第三步:验证订阅链接里备用节点标注的五语言支持(交接文档7.3.5节要求)。
// 覆盖:node-label-i18n.js本身的五语言查表 + pool.js的buildPoolSubscription()
// 实际生成内容时是否正确按语言切换、不认识的语言/不传语言时是否安全回退到中文。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const nodeLabelI18n = require('./core/node-label-i18n');

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) { pass++; console.log(`[OK] ${desc}`); }
  else { fail++; console.log(`[FAIL] ${desc}`); }
}

// ---- 1. node-label-i18n.js 本身 ----
const langs = ['zh', 'en', 'ja', 'de', 'ru'];
for (const l of langs) {
  const suffix = nodeLabelI18n.getBackupSuffix(l);
  const name = nodeLabelI18n.getBackupDefaultName(l);
  check(`${l}: getBackupSuffix返回非空字符串`, typeof suffix === 'string' && suffix.length > 0);
  check(`${l}: getBackupDefaultName返回非空字符串`, typeof name === 'string' && name.length > 0);
}
// 五种语言的后缀应该两两不同(不是复制粘贴忘改)
const allSuffixes = langs.map((l) => nodeLabelI18n.getBackupSuffix(l));
check('五语言的backupSuffix互不相同', new Set(allSuffixes).size === langs.length);

// 不认识的语言 / 不传，安全回退到中文，不抛异常
check('未知语言回退到中文suffix', nodeLabelI18n.getBackupSuffix('xx') === nodeLabelI18n.getBackupSuffix('zh'));
check('不传语言回退到中文suffix', nodeLabelI18n.getBackupSuffix(undefined) === nodeLabelI18n.getBackupSuffix('zh'));

// ---- 2. pool.js的buildPoolSubscription()端到端 ----
// 批次五·第二批改动(创始人明确要求)：不再沿用节点自带原始名字/按来源分文案，
// 统一改成"备用节点-协议名"，多个节点时加序号区分。这里的fixture特意放两个不同
// 协议的节点(vless+vmess)，验证协议识别、序号、五语言、原始标签被丢弃这几件事。
const DATA_DIR = path.join(__dirname, 'data');
const POOL_FILE = path.join(DATA_DIR, 'pool.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const backupBefore = fs.existsSync(POOL_FILE) ? fs.readFileSync(POOL_FILE, 'utf-8') : null;

fs.writeFileSync(POOL_FILE, JSON.stringify({
  updatedAt: '2026-07-12T00:00:00.000Z',
  count: 2,
  nodes: [
    { link: 'vless://uuid@1.2.3.4:443?security=reality#%E5%B7%B2%E6%9C%89%E6%A0%87%E7%AD%BE', addedAt: 'x', lastCheck: null },
    { link: 'vmess://abcd1234', addedAt: 'x', lastCheck: null }
  ],
  lastError: null
}, null, 2));

delete require.cache[require.resolve('./core/pool')];
const pool = require('./core/pool');

function decodeLabels(b64) {
  const text = Buffer.from(b64, 'base64').toString('utf-8');
  return text.split('\n').map((line) => decodeURIComponent(line.split('#')[1] || ''));
}

for (const l of langs) {
  const labels = decodeLabels(pool.buildPoolSubscription(l));
  const backupWord = nodeLabelI18n.getBackupNodeWord(l);
  check(`${l}: 第一个节点(vless)被命名为"${backupWord}-VLESS 1"`, labels[0] === `${backupWord}-VLESS 1`);
  check(`${l}: 第二个节点(vmess)被命名为"${backupWord}-VMess 2"`, labels[1] === `${backupWord}-VMess 2`);
  check(`${l}: 原有的节点自带标签(已有标签)被丢弃，没有出现在新名字里`, !labels[0].includes('已有标签'));
}

// 不传语言 / 传未知语言，安全回退到中文，不抛异常、不产出乱码
const zhLabels = decodeLabels(pool.buildPoolSubscription());
check('buildPoolSubscription()不传参数时回退中文', zhLabels[0] === `${nodeLabelI18n.getBackupNodeWord('zh')}-VLESS 1`);
const xxLabels = decodeLabels(pool.buildPoolSubscription('xx'));
check('buildPoolSubscription("xx")未知语言回退中文', xxLabels[0] === `${nodeLabelI18n.getBackupNodeWord('zh')}-VLESS 1`);

// 池子里只有1个节点时，不加序号(避免"备用节点-VLESS 1"这种多此一举的写法)
fs.writeFileSync(POOL_FILE, JSON.stringify({
  updatedAt: '2026-07-14T00:00:00.000Z',
  count: 1,
  nodes: [{ link: 'trojan://pwd@9.9.9.9:443#随便的名字', addedAt: 'x', lastCheck: null }],
  lastError: null
}, null, 2));
delete require.cache[require.resolve('./core/pool')];
const poolSingle = require('./core/pool');
const singleLabels = decodeLabels(poolSingle.buildPoolSubscription('zh'));
check('只有1个节点时名字不带序号', singleLabels[0] === `${nodeLabelI18n.getBackupNodeWord('zh')}-Trojan`);

// 识别不出协议(scheme异常/缺失)时，用"未知协议"兜底，不抛异常
fs.writeFileSync(POOL_FILE, JSON.stringify({
  updatedAt: '2026-07-14T00:00:00.000Z',
  count: 1,
  nodes: [{ link: '不是一个合法链接', addedAt: 'x', lastCheck: null }],
  lastError: null
}, null, 2));
delete require.cache[require.resolve('./core/pool')];
const poolUnknown = require('./core/pool');
const unknownLabels = decodeLabels(poolUnknown.buildPoolSubscription('zh'));
check('识别不出协议时用"未知协议"兜底、不抛异常', unknownLabels[0] === `${nodeLabelI18n.getBackupNodeWord('zh')}-${nodeLabelI18n.getProtocolUnknownText('zh')}`);

// ---- 2a. 批次五·第三批新增：备用节点名字里的国旗emoji ----
// countryCodeToFlagEmoji本身：合法两位大写字母转国旗，非法输入安全返回空字符串
const { countryCodeToFlagEmoji } = pool._internal;
check('JP转成日本国旗emoji', countryCodeToFlagEmoji('JP') === '\u{1F1EF}\u{1F1F5}');
check('SG转成新加坡国旗emoji', countryCodeToFlagEmoji('SG') === '\u{1F1F8}\u{1F1EC}');
check('null安全返回空字符串', countryCodeToFlagEmoji(null) === '');
check('undefined安全返回空字符串', countryCodeToFlagEmoji(undefined) === '');
check('小写字母(不合法格式)安全返回空字符串', countryCodeToFlagEmoji('jp') === '');
check('三位字母(不合法格式)安全返回空字符串', countryCodeToFlagEmoji('USA') === '');

// buildPoolSubscription端到端：节点带countryCode时，名字里出现对应国旗；没有countryCode时不出现
fs.writeFileSync(POOL_FILE, JSON.stringify({
  updatedAt: '2026-07-14T00:00:00.000Z',
  count: 2,
  nodes: [
    { link: 'vless://uuid@1.2.3.4:443?security=reality#xxx', addedAt: 'x', lastCheck: null, countryCode: 'JP' },
    { link: 'vmess://abcd1234', addedAt: 'x', lastCheck: null, countryCode: null }
  ],
  lastError: null
}, null, 2));
delete require.cache[require.resolve('./core/pool')];
const poolWithCountry = require('./core/pool');
const countryLabels = decodeLabels(poolWithCountry.buildPoolSubscription('zh'));
const backupWordZh = nodeLabelI18n.getBackupNodeWord('zh');
check('有countryCode的节点名字里带对应国旗', countryLabels[0] === `${backupWordZh}-VLESS-\u{1F1EF}\u{1F1F5} 1`);
check('没有countryCode的节点名字里不出现国旗段落(不显示"未知")', countryLabels[1] === `${backupWordZh}-VMess 2`);

// ---- 3. 批次五·第三批改动：node-label-i18n.js的主节点品牌标注字段（不再有suffix，
// 只有固定的mainNodeDefaultName，见node-label-i18n.js顶部本轮改动说明） ----
for (const l of langs) {
  const name = nodeLabelI18n.getMainNodeDefaultName(l);
  check(`${l}: getMainNodeDefaultName返回非空字符串`, typeof name === 'string' && name.length > 0);
}
const allMainNames = langs.map((l) => nodeLabelI18n.getMainNodeDefaultName(l));
check('五语言的mainNodeDefaultName互不相同', new Set(allMainNames).size === langs.length);
check('未知语言回退到中文mainNodeDefaultName', nodeLabelI18n.getMainNodeDefaultName('xx') === nodeLabelI18n.getMainNodeDefaultName('zh'));
check('不传语言回退到中文mainNodeDefaultName', nodeLabelI18n.getMainNodeDefaultName(undefined) === nodeLabelI18n.getMainNodeDefaultName('zh'));
check('主节点默认名跟备用节点后缀不相同(zh)', nodeLabelI18n.getMainNodeDefaultName('zh') !== nodeLabelI18n.getBackupSuffix('zh'));
check('getMainNodeSuffix函数已废弃删除', typeof nodeLabelI18n.getMainNodeSuffix === 'undefined');

// ---- 4. 批次五·第三批改动：pool.js的buildMainNodeSubscription()端到端
// (不再"追加"到原标签，改成不管原链接有没有标签、内容是什么，一律整个替换成固定品牌文案) ----
function decodeSingle(b64) {
  const text = Buffer.from(b64, 'base64').toString('utf-8');
  const hashIdx = text.indexOf('#');
  return {
    base: hashIdx >= 0 ? text.slice(0, hashIdx) : text,
    label: hashIdx >= 0 ? decodeURIComponent(text.slice(hashIdx + 1)) : ''
  };
}

const linkWithLabel = 'vless://uuid@5.6.7.8:443?security=reality#%E6%88%91%E7%9A%84%E8%8A%82%E7%82%B9';
const linkWithoutLabel = 'vless://uuid@5.6.7.8:443?security=reality';

for (const l of langs) {
  const withLabel = decodeSingle(pool.buildMainNodeSubscription(linkWithLabel, l));
  check(`${l}: 主节点原有标签("我的节点")被整个替换掉，不再保留`, withLabel.label === nodeLabelI18n.getMainNodeDefaultName(l));
  check(`${l}: 主节点链接本体没有被改动`, withLabel.base === linkWithLabel.split('#')[0]);

  const withoutLabel = decodeSingle(pool.buildMainNodeSubscription(linkWithoutLabel, l));
  check(`${l}: 主节点没有标签时同样用了对应语言的固定文案`, withoutLabel.label === nodeLabelI18n.getMainNodeDefaultName(l));
}

// 不传语言/未知语言回退中文，不抛异常
const mainZh = decodeSingle(pool.buildMainNodeSubscription(linkWithLabel));
check('buildMainNodeSubscription()不传语言时回退中文', mainZh.label === nodeLabelI18n.getMainNodeDefaultName('zh'));
const mainXx = decodeSingle(pool.buildMainNodeSubscription(linkWithLabel, 'xx'));
check('buildMainNodeSubscription(link,"xx")未知语言回退中文', mainXx.label === nodeLabelI18n.getMainNodeDefaultName('zh'));

// 空链接/未传链接：直接返回空字符串，不拼任何东西，不抛异常
check('buildMainNodeSubscription("")空链接返回空字符串', pool.buildMainNodeSubscription('', 'zh') === '');
check('buildMainNodeSubscription(undefined)不传链接返回空字符串', pool.buildMainNodeSubscription(undefined, 'zh') === '');

// ---- 5. 批次五·第一批新增：pool.js的getActiveNodesSummary() ----
// 复用上面写好的fixture pool.json（两个节点：一个有sourceId标签的、一个没有sourceId的
// legacy aggregator节点），验证按sourceId去重、tier解析、countryCode透传这几件事。
fs.writeFileSync(POOL_FILE, JSON.stringify({
  updatedAt: '2026-07-14T00:00:00.000Z',
  count: 3,
  nodes: [
    { link: 'vless://a@1.1.1.1:443#a', addedAt: 'x', lastCheck: null, sourceId: 'orgA/repoA', countryCode: 'SG' },
    { link: 'vless://b@2.2.2.2:443#b', addedAt: 'x', lastCheck: null, sourceId: 'orgA/repoA', countryCode: 'SG' },
    { link: 'vmess://legacy', addedAt: 'x', lastCheck: null }
  ],
  lastError: null
}, null, 2));
delete require.cache[require.resolve('./core/pool')];
const pool2 = require('./core/pool');

const summary = pool2.getActiveNodesSummary();
check('getActiveNodesSummary返回数组', Array.isArray(summary));
check('同一sourceId的两个节点被去重成1条', summary.filter((s) => s.sourceId === 'orgA/repoA').length === 1);
check('没有sourceId的节点被归到legacy aggregator', summary.some((s) => s.sourceId === 'aggregator-default'));
const orgAEntry = summary.find((s) => s.sourceId === 'orgA/repoA');
check('orgA/repoA的countryCode被正确透传', !!orgAEntry && orgAEntry.countryCode === 'SG');
check('返回结果一共2条(去重后)', summary.length === 2);

// 池子为空时不报错，返回空数组
fs.writeFileSync(POOL_FILE, JSON.stringify({ updatedAt: null, count: 0, nodes: [], lastError: null }, null, 2));
delete require.cache[require.resolve('./core/pool')];
const pool3 = require('./core/pool');
check('空池子时getActiveNodesSummary返回空数组', Array.isArray(pool3.getActiveNodesSummary()) && pool3.getActiveNodesSummary().length === 0);

// 清理:恢复测试前的pool.json状态,不留垃圾数据
if (backupBefore === null) {
  fs.unlinkSync(POOL_FILE);
} else {
  fs.writeFileSync(POOL_FILE, backupBefore);
}

console.log(`\n总计: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
