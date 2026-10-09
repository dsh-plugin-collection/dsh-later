/**
 * 测试辅助：把所有权 sidecar 指到一次性临时目录，并提供标记/清空工具。
 *
 * **导入即生效**：本模块在加载时就把状态目录指向临时目录，因此任何
 * `import … from './helpers/ownership-state.mjs'` 的测试文件都不可能写到
 * `~/.dsh/plugin-state/later`。
 *
 * 历史教训：此前要求调用方在导入 lib **之前**手动调用 `freshOwnershipDir()`，
 * 但 ESM 的 import 会被提升——该约束在语法上就无法满足。结果是 15 个测试里
 * 有 11 个实际写进了**真实用户目录**，并让断言因残留状态而互相干扰
 * （P0-1 两条在单独运行时通过、在整文件运行时失败）。
 *
 * `freshOwnershipDir()` 仍保留，用于需要在单个测试内**再次**重置目录的场景。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordOwnership, resetCacheForTests } from '../../lib/ownership-store.js';

/** 新建一次性状态目录并让插件指向它；返回目录路径。 */
export function freshOwnershipDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sched-ownership-'));
  process.env.DSH_LATER_STATE_DIR = dir;
  resetCacheForTests();
  return dir;
}

// 导入即隔离：先于任何被测模块的实际调用发生。
freshOwnershipDir();

/** 在当前状态目录里标记一条用户所有权（等价于旧版写入伴生事件）。 */
export function markOwnership(sessionId, id, delivery = 'context') {
  recordOwnership(sessionId, id, delivery);
}
