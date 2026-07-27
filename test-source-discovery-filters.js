'use strict';

// 本次会话新增:此前 filterByProtocolTopic（v21引入的"协议标签共现"过滤规则）
// 一直是零测试覆盖，本次核实4个待办时发现的真实缺口，这里补上。
// 同时覆盖本次新增的 isWithinRecency（filename代码搜索结果的二次时效性过滤——
// GitHub代码搜索API本身不支持pushed:这类新鲜度查询参数，只能拿到结果后自己过滤）。

const assert = require('assert');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function run() {
  const { filterByProtocolTopic, isWithinRecency } = require('./core/source-discovery');

  // ---------- filterByProtocolTopic ----------

  test('只靠topic命中、且标签里没有任何协议关键词的来源被过滤掉', () => {
    const sources = [
      { repoFullName: 'a/http-proxy-list', matchedBy: ['topic:free-node'], topics: ['proxy', 'list'] }
    ];
    const { kept, filteredOut } = filterByProtocolTopic(sources);
    assert.strictEqual(kept.length, 0);
    assert.strictEqual(filteredOut, 1);
  });

  test('只靠topic命中、但标签里确实带协议关键词的来源被保留', () => {
    const sources = [
      { repoFullName: 'a/real-aggregator', matchedBy: ['topic:free-node'], topics: ['clash', 'free-node'] }
    ];
    const { kept, filteredOut } = filterByProtocolTopic(sources);
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(filteredOut, 0);
  });

  test('靠filename命中的来源即使没有任何协议标签，也不受这条规则限制（更强信号）', () => {
    const sources = [
      { repoFullName: 'a/found-by-filename', matchedBy: ['filename:v2ray.txt'], topics: [] }
    ];
    const { kept, filteredOut } = filterByProtocolTopic(sources);
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(filteredOut, 0);
  });

  test('同时靠topic和filename命中的来源不受限制（matchedBy不全是topic:前缀）', () => {
    const sources = [
      { repoFullName: 'a/both', matchedBy: ['topic:free-node', 'filename:v2ray.txt'], topics: ['proxy'] }
    ];
    const { kept, filteredOut } = filterByProtocolTopic(sources);
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(filteredOut, 0);
  });

  test('协议关键词匹配大小写不敏感', () => {
    const sources = [
      { repoFullName: 'a/upper-tag', matchedBy: ['topic:free-node'], topics: ['CLASH'] }
    ];
    const { kept, filteredOut } = filterByProtocolTopic(sources);
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(filteredOut, 0);
  });

  // ---------- isWithinRecency ----------

  test('最近更新的仓库(1天前)在30天阈值内，判定为true', () => {
    const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    assert.strictEqual(isWithinRecency(oneDayAgo, 30), true);
  });

  test('很久没更新的仓库(比如两年前)超过30天阈值，判定为false', () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();
    assert.strictEqual(isWithinRecency(twoYearsAgo, 30), false);
  });

  test('恰好卡在阈值边界内(29天前，阈值30天)判定为true', () => {
    const justInside = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
    assert.strictEqual(isWithinRecency(justInside, 30), true);
  });

  test('lastUpdated缺失(null/undefined)时保守放行，不因为信息缺失就误伤', () => {
    assert.strictEqual(isWithinRecency(null, 30), true);
    assert.strictEqual(isWithinRecency(undefined, 30), true);
  });

  test('lastUpdated是非法日期字符串时保守放行', () => {
    assert.strictEqual(isWithinRecency('not-a-real-date', 30), true);
  });

  console.log(`\n${passed} 项测试通过`);
}

// ---------- 端到端:discoverSources真的把过滤接上了,不只是isWithinRecency本身对 ----------

async function runIntegration() {
  const originalFetch = global.fetch;
  delete require.cache[require.resolve('./core/source-discovery')];
  const { discoverSources } = require('./core/source-discovery');

  const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

  global.fetch = async (url) => {
    if (url.includes('/search/code')) {
      return {
        ok: true,
        headers: { get: () => '10' },
        json: async () => ({
          items: [
            {
              path: 'v2ray.txt',
              repository: { full_name: 'a/fresh-repo', html_url: 'https://github.com/a/fresh-repo', pushed_at: oneDayAgo, topics: [], stargazers_count: 1 }
            },
            {
              path: 'v2ray.txt',
              repository: { full_name: 'a/stale-repo', html_url: 'https://github.com/a/stale-repo', pushed_at: twoYearsAgo, topics: [], stargazers_count: 1 }
            }
          ]
        })
      };
    }
    return { ok: true, headers: { get: () => '10' }, json: async () => ({ items: [] }) };
  };

  try {
    const result = await discoverSources({
      topicQueries: [],
      filenameQueries: ['v2ray.txt'],
      githubToken: 'fake-token-for-test',
      maxResultsPerQuery: 10,
      recentPushedWithinDays: 30,
      requestTimeoutMs: 1000
    });
    const names = result.found.map((s) => s.repoFullName);
    if (names.includes('a/fresh-repo') && !names.includes('a/stale-repo')) {
      passed++;
      console.log('  ok - discoverSources端到端确认:filename命中的新鲜仓库保留、过期仓库(两年前)被过滤');
    } else {
      process.exitCode = 1;
      console.error(`  FAIL - discoverSources端到端过滤未生效，实际found: ${JSON.stringify(names)}`);
    }
  } finally {
    global.fetch = originalFetch;
  }

  console.log(`\n共 ${passed} 项测试通过`);
}

run();
runIntegration();
