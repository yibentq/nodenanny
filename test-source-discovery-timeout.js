'use strict';

// 2026-07-15新增:验证 source-discovery.js 的超时保护修复。
// 背景(交接文档v36.0第47节真机诊断):searchRepositoriesByTopic/searchCodeByFilename
// 之前是裸调用fetch()，没有任何超时保护——一旦某次请求卡住(网络抖动/对方无响应)，
// await fetch()会永远挂起，不返回也不报错，导致整个refreshPool()卡死超过51分钟，
// 且没有任何子进程/网络连接残留可供排查。
//
// 这里不连真实api.github.com(沙盒没有网络白名单，也不该依赖真实网络的可用性来
// 验证一个"超时保护"逻辑本身)，而是用mock global.fetch模拟"请求永远不resolve"
// 这个最极端的挂起场景，验证：
// 1. discoverSources()能在可控时间内返回，不会挂起。
// 2. 超时被正确记录进errors数组，不会让整个扫描抛异常崩溃。
// 3. 正常响应的请求不受影响，行为跟修复前一致。

const assert = require('assert');

let passed = 0;
function test(name, fn) {
  return fn()
    .then(() => {
      passed++;
      console.log(`  ok - ${name}`);
    })
    .catch((err) => {
      console.error(`  FAIL - ${name}`);
      console.error(err);
      process.exitCode = 1;
    });
}

function loadFreshModule() {
  // discoverSources内部直接引用全局fetch，每次测试前重新require，
  // 避免不同mock之间因为require缓存互相影响(虽然这个模块本身没有状态，但保持干净)。
  delete require.cache[require.resolve('./core/source-discovery')];
  return require('./core/source-discovery');
}

async function run() {
  const originalFetch = global.fetch;

  await test('请求永远不resolve时，discoverSources仍能在超时时间内返回(不会挂起)', async () => {
    // 关键:mock必须像真实fetch(undici)一样响应AbortSignal——signal触发时reject成
    // AbortError，而不是永远悬空不resolve也不reject。一个完全不理会abort信号的
    // mock，本身就不代表"网络请求卡住"这个真实场景(真实卡住的连接被abort()之后
    // 底层socket会被真的切断，fetch()会真的reject)，用那种mock测不出超时保护
    // 有没有生效，只会让Node事件循环空闲后静默退出、测试断言完全跑不到。
    global.fetch = (url, options) => new Promise((resolve, reject) => {
      const signal = options && options.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
      // 不调用resolve/reject，模拟请求本身卡住不返回，只靠上面的abort监听来解除卡住
    });
    const { discoverSources } = loadFreshModule();

    const started = Date.now();
    const result = await discoverSources({
      topicQueries: ['vpn'],
      filenameQueries: [],
      maxResultsPerQuery: 10,
      recentPushedWithinDays: 7,
      requestTimeoutMs: 100 // 测试用短超时，不用等真实的8秒默认值
    });
    const elapsedMs = Date.now() - started;

    assert.ok(elapsedMs < 2000, `应该在超时时间附近就返回，不应该挂起(实际耗时${elapsedMs}ms)`);
    assert.strictEqual(result.found.length, 0, '超时的query不应该产生任何候选');
    assert.strictEqual(result.errors.length, 1, '超时应该被记录进errors，不是被吞掉');
    assert.ok(result.errors[0].query.includes('topic:vpn'));
  });

  await test('filenameQueries里挂起的请求同样会超时返回，不影响整体扫描完成', async () => {
    global.fetch = (url, options) => new Promise((resolve, reject) => {
      const signal = options && options.signal;
      if (signal) {
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });
    const { discoverSources } = loadFreshModule();

    const result = await discoverSources({
      topicQueries: [],
      filenameQueries: ['sub.json'],
      maxResultsPerQuery: 10,
      recentPushedWithinDays: 7,
      githubToken: 'fake-token-for-test',
      requestTimeoutMs: 100
    });

    assert.strictEqual(result.errors.length, 1);
    assert.ok(result.errors[0].query.includes('filename:sub.json'));
  });

  await test('正常能拿到响应时，行为不受超时保护改动影响(功能不倒退)', async () => {
    global.fetch = async (url) => ({
      ok: true,
      status: 200,
      headers: { get: () => '59' },
      json: async () => ({
        items: [
          {
            full_name: 'someorg/somerepo',
            html_url: 'https://github.com/someorg/somerepo',
            pushed_at: '2026-07-01T00:00:00Z',
            topics: ['vpn'],
            stargazers_count: 5
          }
        ]
      })
    });
    const { discoverSources } = loadFreshModule();

    const result = await discoverSources({
      topicQueries: ['vpn'],
      filenameQueries: [],
      maxResultsPerQuery: 10,
      recentPushedWithinDays: 7,
      requestTimeoutMs: 100
    });

    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.found.length, 1);
    assert.strictEqual(result.found[0].repoFullName, 'someorg/somerepo');
    assert.strictEqual(result.rateLimitRemaining, '59');
  });

  await test('不传requestTimeoutMs时,兜底用8秒默认值,不会立刻超时误杀正常请求', async () => {
    let receivedSignal = null;
    global.fetch = async (url, options) => {
      receivedSignal = options && options.signal;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ items: [] })
      };
    };
    const { discoverSources } = loadFreshModule();

    await discoverSources({
      topicQueries: ['vpn'],
      filenameQueries: [],
      maxResultsPerQuery: 10,
      recentPushedWithinDays: 7
      // 故意不传requestTimeoutMs
    });

    assert.ok(receivedSignal, '即使没传requestTimeoutMs，也应该带上AbortSignal(用默认超时兜底)');
    assert.strictEqual(receivedSignal.aborted, false, '正常快速返回的请求不应该被提前abort');
  });

  global.fetch = originalFetch;
}

run().then(() => {
  console.log(`\n${passed} 项通过`);
  if (process.exitCode) {
    console.error('存在失败项');
    process.exit(1);
  }
});
