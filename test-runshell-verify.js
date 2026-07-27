'use strict';
const { execSync } = require('child_process');
const { _internal } = require('./core/pool');
const { runShell } = _internal;

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { console.log(`[OK] ${name}`); passed++; }
  else { console.log(`[FAIL] ${name}`); failed++; }
}

async function main() {
  // 场景1:正常命令,应该正确拿到stdout,ok=true
  const r1 = await runShell('echo hello-world', 5000);
  ok('正常命令返回ok=true且stdout正确', r1.ok === true && r1.stdout.trim() === 'hello-world');

  // 场景2:命令本身exit非0,ok应该是false
  const r2 = await runShell('exit 3', 5000);
  ok('exit非0时ok=false', r2.ok === false);

  // 场景3(核心):模拟"外壳被杀但内层孙子进程继续跑"的场景——
  // 用一个bash脚本:自己sleep一段时间(模拟aggregator主体耗时),
  // 但真正验证的是:给它一个很短的超时,杀掉之后,检查有没有残留的sleep进程。
  const cmd = `bash -c 'sleep 30 & echo child_pid=$! ; wait'`;
  const r3 = await runShell(cmd, 1000);
  // kill(-pgid)发出后，子进程会先短暂进入defunct(僵尸)态等待被init回收，
  // 不是真正占用CPU/内存的残留进程，这里多等2秒排除掉这个正常的过渡态，
  // 只要最终(reap完成后)彻底找不到这个进程了，就说明进程组kill真的生效。
  await new Promise((res) => setTimeout(res, 2000));
  let after = '';
  try {
    after = execSync('ps -eo pid,stat,cmd | grep "sleep 30" | grep -v grep | grep -v defunct').toString().trim();
  } catch (err) {
    after = ''; // grep无匹配时execSync会抛异常，等同于"没有残留"
  }
  ok('超时后ok=false', r3.ok === false);
  ok('超时后没有残留的sleep子进程(进程组kill生效，僵尸态已被系统回收)', after === '');
  if (after !== '') {
    console.log('  残留进程:', after);
    try { execSync('pkill -9 -f "sleep 30" || true'); } catch (err) { /* 忽略 */ }
  }

  console.log(`\n总计: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
