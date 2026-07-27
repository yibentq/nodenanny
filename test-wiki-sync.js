'use strict';

// wiki-sync.js 的单元测试。只测试不碰网络/文件系统的纯逻辑部分（isSafeRelPath /
// filterWikiTreeEntries / computeFingerprint / diffAgainstState），这几个函数
// 覆盖了这个模块里真正容易出bug、也最值得保护的部分：路径穿越防护 + diff是否正确。
// checkForUpdate/applyUpdate 依赖真实GitHub API，不在这里做网络mock测试，
// 跟项目里kb-sync.js的测试覆盖策略保持一致（kb-sync.js本身也没有单独的测试文件，
// 这次wiki-sync.js至少把能脱离网络测的部分测了，比完全不测更好）。

const assert = require('assert');
const wikiSync = require('./core/wiki-sync');

let passed = 0;
function check(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed += 1;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('isSafeRelPath');
check('正常的markdown相对路径通过', () => {
  assert.strictEqual(wikiSync.isSafeRelPath('02-nodenanny-guide/overview.md'), true);
});
check('正常的json相对路径通过', () => {
  assert.strictEqual(wikiSync.isSafeRelPath('01-airports-and-vpn/_category.json'), true);
});
check('包含 .. 段的路径被拒绝', () => {
  assert.strictEqual(wikiSync.isSafeRelPath('../../etc/passwd.md'), false);
});
check('以 / 开头的绝对路径被拒绝', () => {
  assert.strictEqual(wikiSync.isSafeRelPath('/etc/passwd.md'), false);
});
check('包含反斜杠的路径被拒绝', () => {
  assert.strictEqual(wikiSync.isSafeRelPath('foo\\..\\bar.md'), false);
});
check('不在扩展名白名单内的文件被拒绝（比如.sh）', () => {
  assert.strictEqual(wikiSync.isSafeRelPath('02-nodenanny-guide/evil.sh'), false);
});
check('空字符串/非字符串输入被拒绝', () => {
  assert.strictEqual(wikiSync.isSafeRelPath(''), false);
  assert.strictEqual(wikiSync.isSafeRelPath(null), false);
  assert.strictEqual(wikiSync.isSafeRelPath(undefined), false);
});

console.log('filterWikiTreeEntries');
check('只保留wiki路径前缀下的blob条目，正确剥掉前缀', () => {
  const entries = [
    { path: 'data/wiki/02-nodenanny-guide/overview.md', type: 'blob', sha: 'aaa' },
    { path: 'data/wiki/02-nodenanny-guide', type: 'tree', sha: 'bbb' }, // 目录本身，应跳过
    { path: 'core/panel-server.js', type: 'blob', sha: 'ccc' }, // 不在wiki路径下，应跳过
    { path: 'data/wiki/../secret.md', type: 'blob', sha: 'ddd' } // 穿越路径，应跳过
  ];
  const result = wikiSync.filterWikiTreeEntries(entries, 'data/wiki');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].relPath, '02-nodenanny-guide/overview.md');
  assert.strictEqual(result[0].sha, 'aaa');
});
check('wiki路径前缀不带末尾斜杠也能正常工作', () => {
  const entries = [{ path: 'wiki/a.md', type: 'blob', sha: '111' }];
  const result = wikiSync.filterWikiTreeEntries(entries, 'wiki');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].relPath, 'a.md');
});

console.log('computeFingerprint');
check('相同内容不同顺序得到相同指纹', () => {
  const a = wikiSync.computeFingerprint([{ relPath: 'b.md', sha: '2' }, { relPath: 'a.md', sha: '1' }]);
  const b = wikiSync.computeFingerprint([{ relPath: 'a.md', sha: '1' }, { relPath: 'b.md', sha: '2' }]);
  assert.strictEqual(a, b);
});
check('内容不同得到不同指纹', () => {
  const a = wikiSync.computeFingerprint([{ relPath: 'a.md', sha: '1' }]);
  const b = wikiSync.computeFingerprint([{ relPath: 'a.md', sha: '2' }]);
  assert.notStrictEqual(a, b);
});

console.log('diffAgainstState');
check('全新文件被判定为added', () => {
  const diff = wikiSync.diffAgainstState([{ relPath: 'new.md', sha: '1' }], {});
  assert.deepStrictEqual(diff.added, ['new.md']);
  assert.deepStrictEqual(diff.changed, []);
  assert.deepStrictEqual(diff.removed, []);
});
check('sha变化的文件被判定为changed', () => {
  const diff = wikiSync.diffAgainstState([{ relPath: 'a.md', sha: 'new-sha' }], { 'a.md': 'old-sha' });
  assert.deepStrictEqual(diff.changed, ['a.md']);
});
check('本地有远程没有的文件被判定为removed（镜像语义）', () => {
  const diff = wikiSync.diffAgainstState([], { 'gone.md': 'sha' });
  assert.deepStrictEqual(diff.removed, ['gone.md']);
});
check('sha相同的文件不出现在任何一类里', () => {
  const diff = wikiSync.diffAgainstState([{ relPath: 'same.md', sha: 'x' }], { 'same.md': 'x' });
  assert.deepStrictEqual(diff.added, []);
  assert.deepStrictEqual(diff.changed, []);
  assert.deepStrictEqual(diff.removed, []);
});
check('同时有added/changed/removed的复合场景', () => {
  const remote = [
    { relPath: 'kept-same.md', sha: 'x' },
    { relPath: 'kept-changed.md', sha: 'new' },
    { relPath: 'brand-new.md', sha: 'y' }
  ];
  const state = { 'kept-same.md': 'x', 'kept-changed.md': 'old', 'deleted-remote.md': 'z' };
  const diff = wikiSync.diffAgainstState(remote, state);
  assert.deepStrictEqual(diff.added.sort(), ['brand-new.md']);
  assert.deepStrictEqual(diff.changed.sort(), ['kept-changed.md']);
  assert.deepStrictEqual(diff.removed.sort(), ['deleted-remote.md']);
});

console.log(`\n${passed} 项断言通过`);
if (process.exitCode) {
  console.error('存在失败的断言');
  process.exit(1);
}
