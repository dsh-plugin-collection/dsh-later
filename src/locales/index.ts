/**
 * 宿主侧 8 语言字典的统一入口。
 *
 * 本模块只汇总 `./host.ts` 与 `./locale-id.ts`，**不**再导出客户端词条：客户端的两门
 * （dock/面板的 `ui.ts`、设置卡的 `settings.ts`）住在 `src/client/locales/`。
 *
 * ## 为什么客户端词条必须在 `src/client/` 以下
 *
 * 不是风格问题，是两条门禁交叉作用的结果：
 *  - 根 `tsconfig.json` 编译 `src/**` 并**真的 emit**；`src/client` 被它 exclude，
 *    由 esbuild 在 `build.mjs` 里单独 bundle 进 `lib/client.js`。
 *  - `check:lib-reach` 要求 `lib/` 下每个 `.js` 都能从 `lib/index.js` 静态走到。
 *
 * 把客户端词条放在 `src/locales/ui.ts`，这两条会同时成立且互相打架：tsc 照样给它产出
 * `lib/locales/ui.js`（客户端用的模块），但宿主入口永远不 import 它，于是它成了「宿主
 * 永远不会执行的死产物」——门禁如实判红。搬到 `src/client/locales/` 后它落进
 * `tsconfig.json` 的 exclude，与 `presence.ts` / `schedule-summary.ts` 那批同一处理方式。
 *
 * 共享的 `locale-id.ts` 留在本目录：宿主与客户端都要 `LOCALE_IDS`，而它没有客户端专用
 * 依赖，宿主入口经 `host.ts` 静态走到它，产物可达。
 *
 * @module dsh-later/locales
 */

export {
  LOCALE_IDS,
  isLocaleId,
  type LocaleId,
} from './locale-id.js';

export {
  hostDicts,
  hostDictFor,
  hostFormat,
  type HostUIKey,
} from './host.js';
