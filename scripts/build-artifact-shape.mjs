/**
 * host 产物形态判据（纯函数，可测、不碰文件系统）。
 *
 * 为什么需要它（issue #56）：`lib/index.js` 有两种可能形态——
 *   1. **逐文件 tsc 产物**（正常路径）：每个 src 模块各自编译成一个 lib/*.js，
 *      index.js 用相对导入 `./projection.js` 等引用兄弟模块，模块身份只有一份。
 *   2. **esbuild 兜底产物**（tsc 失败时）：所有兄弟模块被内联进单个
 *      index.js，文件从 ≈24.6KB 涨到 ≈128KB，模块身份/状态单例被复制。
 * 两种形态在磁盘上都叫 lib/index.js，光看「构建成功」分不出来。把判据抽成
 * 纯函数后，测试既能守住仓库里那份产物，也能对兜底产物**判红**（证明判据
 * 本身不是永远通过的摆设）。
 * @module dsh-later/scripts/build-artifact-shape
 */

/**
 * 逐文件 tsc 产物的体积上限。
 *
 * 实测：tsc 逐文件产物 ≈24.6KB，esbuild 内联兜底 ≈128KB。取 64KB 留出
 * 一倍多的正常增长空间，又远低于兜底产物的量级。改上限前先量一次真实产物。
 */
export const HOST_INDEX_BYTE_CAP = 64 * 1024;

/** 逐文件产物至少应有的相对导入条数（index.ts 当前有 7 条）。 */
export const PER_FILE_RELATIVE_IMPORT_MIN = 1;

/** esbuild 打包时给每个内联源文件加的分节注释，例如 `// src/projection.ts`。 */
const INLINED_SOURCE_MARKER = /^\/\/ src\/[\w./-]+\.(?:ts|tsx|js|mjs|cjs)$/gm;

/** 逐文件 tsc 产物里的相对导入（`from './xxx.js'`）。 */
const RELATIVE_IMPORT = /from\s+['"]\.\/[^'"]+['"]/g;

/**
 * 判断一段 host 产物源码是不是**逐文件 tsc 产物**。
 *
 * 三条判据互补：体积（最粗）、保留相对导入（模块身份没被拍平）、没有
 * esbuild 的内联源文件分节注释（兄弟模块没被整段复制进来）。任一条不满足
 * 就判红，并把原因写进 `problems`，方便测试失败时直接看出形态是怎么变的。
 *
 * @param text 产物源码（lib/index.js 的内容）。
 * @param options.byteCap 体积上限，默认 {@link HOST_INDEX_BYTE_CAP}。
 * @returns `{ ok, shape, bytes, relativeImports, inlinedMarkers, problems }`，
 *   `shape` 为 `'tsc-per-file'`（三条全过）或 `'bundled'`（有任一条不过）。
 */
export function inspectHostArtifact(text, options = {}) {
  const byteCap = options.byteCap ?? HOST_INDEX_BYTE_CAP;
  const source = String(text ?? '');
  const bytes = Buffer.byteLength(source, 'utf8');
  const relativeImports = source.match(RELATIVE_IMPORT)?.length ?? 0;
  const inlinedMarkers = [...source.matchAll(INLINED_SOURCE_MARKER)].map((m) => m[0]);

  const problems = [];
  if (bytes > byteCap) {
    problems.push(
      `体积 ${bytes}B 超过逐文件 tsc 产物的上限 ${byteCap}B：兄弟模块疑似被内联成 bundle`,
    );
  }
  if (relativeImports < PER_FILE_RELATIVE_IMPORT_MIN) {
    problems.push(
      `没有任何相对导入（逐文件产物应从 './xxx.js' 引用兄弟模块；为 0 说明模块已被拍平）`,
    );
  }
  if (inlinedMarkers.length > 0) {
    problems.push(
      `出现 esbuild 内联源文件分节注释（${inlinedMarkers.slice(0, 3).join('、')}）：兄弟模块被整段复制进来`,
    );
  }

  return {
    ok: problems.length === 0,
    shape: problems.length === 0 ? 'tsc-per-file' : 'bundled',
    bytes,
    relativeImports,
    inlinedMarkers,
    problems,
  };
}

/**
 * 断言产物是逐文件 tsc 产物；判红时把 `problems` 拼成人能读的失败信息。
 * @param text 产物源码。
 * @param label 报错里用来标识产物的名字（如 `lib/index.js`）。
 * @param options 透传给 {@link inspectHostArtifact}。
 * @returns {@link inspectHostArtifact} 的返回值（`ok` 为 true）。
 */
export function assertPerFileArtifact(text, label = 'lib/index.js', options = {}) {
  const report = inspectHostArtifact(text, options);
  if (!report.ok) {
    throw new Error(
      `${label} 不是逐文件 tsc 产物（形态=${report.shape}）：\n- ${report.problems.join('\n- ')}`,
    );
  }
  return report;
}
