'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`[OK] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name}`); }
}

// 本轮修复(自查发现的真实bug,同test-pool-e2e.js等):core/repo-fetch.js内部把探测缓存
// 硬编码写到仓库真实的 data/repo-fetch-probe-cache.json,这个测试文件调用
// fetchCandidatesForSource时会真的往这个文件里写入orgA/repoA等测试假数据,而且之前
// 完全没有清理/恢复,是这次全量回归时才发现的第四处同类问题。修复方式跟其它几个
// 测试文件一致:备份/恢复,不直接删除或者留污染。
const DATA_DIR = path.join(__dirname, 'data');
const DATA_BACKUP_DIR = DATA_DIR + '.pretest-backup-' + process.pid;
let realDataWasBackedUp = false;
if (fs.existsSync(DATA_DIR)) {
  fs.renameSync(DATA_DIR, DATA_BACKUP_DIR);
  realDataWasBackedUp = true;
}
process.on('exit', () => {
  try {
    if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
    if (realDataWasBackedUp) fs.renameSync(DATA_BACKUP_DIR, DATA_DIR);
  } catch (restoreErr) {
    console.error('[test-repo-fetch] 恢复真实data目录时出错,请手动检查:', restoreErr.message);
  }
});

const V2RAY_LINKS_PLAIN = 'vless://uuid1@1.1.1.1:443?security=tls&type=tcp&sni=a.com#n1\nvmess://' + Buffer.from(JSON.stringify({ v: '2', ps: 'n2', add: '2.2.2.2', port: '443', id: 'uuid2', aid: '0', net: 'tcp', tls: 'tls' })).toString('base64');
const V2RAY_LINKS_BASE64 = Buffer.from(V2RAY_LINKS_PLAIN, 'utf-8').toString('base64');

const CLASH_YAML_SAMPLE = `
proxies:
  - name: clashnode1
    type: ss
    server: 3.3.3.3
    port: 8388
    cipher: aes-256-gcm
    password: pw123
`;

// 用一个可编程的假 fetch,根据 URL 分支返回不同结果,模拟三种场景:
// repoA(filename命中,已知路径,base64订阅) / repoB(topic命中,猜测命中clash.yaml) / repoC(什么都没有)
global.fetch = async (url, opts) => {
  // 仓库信息(取默认分支)
  if (url.includes('/repos/orgA/repoA') && !url.includes('/contents/')) {
    return { ok: true, json: async () => ({ default_branch: 'main' }) };
  }
  if (url.includes('/repos/orgB/repoB') && !url.includes('/contents/')) {
    return { ok: true, json: async () => ({ default_branch: 'main' }) };
  }
  if (url.includes('/repos/orgC/repoC') && !url.includes('/contents/')) {
    return { ok: false, status: 404 };
  }

  // repoA:已知路径 data/v2ray.txt,直接raw抓取,内容是base64订阅
  if (url === 'https://raw.githubusercontent.com/orgA/repoA/main/data/v2ray.txt') {
    return { ok: true, text: async () => V2RAY_LINKS_BASE64 };
  }

  // repoB:topic命中,contents API探测 clash.yaml 存在
  if (url.includes('/repos/orgB/repoB/contents/clash.yaml')) {
    return { ok: true, json: async () => ({ name: 'clash.yaml' }) };
  }
  // 其他猜测文件名一律不存在
  if (url.includes('/repos/orgB/repoB/contents/')) {
    return { ok: false, status: 404 };
  }
  if (url === 'https://raw.githubusercontent.com/orgB/repoB/main/clash.yaml') {
    return { ok: true, text: async () => CLASH_YAML_SAMPLE };
  }

  // repoC:什么猜测都探测不到
  if (url.includes('/repos/orgC/repoC/contents/')) {
    return { ok: false, status: 404 };
  }

  return { ok: false, status: 404 };
};

const { fetchCandidatesForSource, parseSubscriptionContent } = require('./core/repo-fetch');

async function main() {
  // 场景1:filename命中,已知路径,base64订阅解析
  const recA = { repoFullName: 'orgA/repoA', matchedBy: ['filename:v2ray.txt'], matchedFiles: [{ filename: 'v2ray.txt', path: 'data/v2ray.txt' }] };
  const resultA = await fetchCandidatesForSource(recA, {}, {});
  check('repoA 抓到2条链接', resultA.links.length === 2);
  check('repoA links包含vless', resultA.links.some((l) => l.startsWith('vless://')));
  check('repoA links包含vmess', resultA.links.some((l) => l.startsWith('vmess://')));
  check('repoA filesFound记录了抓到的文件', resultA.filesFound.length >= 1);

  // 场景2:topic命中,猜文件名探测到clash.yaml
  const recB = { repoFullName: 'orgB/repoB', matchedBy: ['topic:v2ray-node'], matchedFiles: [] };
  const resultB = await fetchCandidatesForSource(recB, {}, {});
  check('repoB 通过猜测拿到1条clash yaml转换出的链接', resultB.links.length === 1 && resultB.links[0].startsWith('ss://'));

  // 场景3:什么都抓不到,安全返回空数组,不抛异常
  const recC = { repoFullName: 'orgC/repoC', matchedBy: ['topic:free-nodes'], matchedFiles: [] };
  const resultC = await fetchCandidatesForSource(recC, {}, {});
  check('repoC 抓不到任何内容时返回空数组而不是抛异常', Array.isArray(resultC.links) && resultC.links.length === 0);

  // parseSubscriptionContent 单独测试三种格式识别
  check('parseSubscriptionContent识别明文链接', parseSubscriptionContent(V2RAY_LINKS_PLAIN).format === 'raw-links');
  check('parseSubscriptionContent识别base64订阅', parseSubscriptionContent(V2RAY_LINKS_BASE64).format === 'base64-links');
  check('parseSubscriptionContent识别clash yaml', parseSubscriptionContent(CLASH_YAML_SAMPLE).format === 'clash-yaml');
  check('parseSubscriptionContent对无关内容返回unrecognized', parseSubscriptionContent('random unrelated text content here').format === 'unrecognized');
  check('parseSubscriptionContent对空内容返回empty', parseSubscriptionContent('').format === 'empty');

  // 回归测试:hy2:// 前缀之前被候选行正则漏掉(与proxy-parse.js已支持的hy2://不一致),
  // 导致所有hy2://写法的Hysteria2节点在"挑候选行"这一步就被静默丢弃。
  // 用贴近"旺财"订阅真实场景的HK/SG两条hy2://节点验证修复。
  const HY2_LINKS_PLAIN = 'hy2://pw1@1.2.3.4:443?sni=a.com#HK\nhy2://pw2@5.6.7.8:443?sni=b.com#SG';
  const hy2Result = parseSubscriptionContent(HY2_LINKS_PLAIN);
  check('parseSubscriptionContent识别hy2://明文链接(HK+SG两条都命中)', hy2Result.format === 'raw-links' && hy2Result.links.length === 2);
  check('parseSubscriptionContent的hy2://链接大小写不敏感', parseSubscriptionContent('HY2://pw@1.2.3.4:443#x').links.length === 1);
  // 混合场景:同一份订阅里hy2://和hysteria2://混用,以及和其它协议混用,都应该全部识别到
  const MIXED_WITH_HY2 = 'vless://uuid1@1.1.1.1:443#n1\nhy2://pw1@2.2.2.2:443#HK\nhysteria2://pw2@3.3.3.3:443#SG';
  check('parseSubscriptionContent混合协议中hy2://与hysteria2://都能识别', parseSubscriptionContent(MIXED_WITH_HY2).links.length === 3);

  console.log(`\n总计: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
