/**
 * dsh-later client 端：会话输入框右侧的「定时提醒」按钮 + 面板。
 *
 * 数据流：
 *  - 读状态：`useProjection('userSchedules')`（宿主会话投影实时推送）。
 *  - 写状态：`session.command('/user-schedule-create ...')` 等 slash 命令
 *    直达宿主（命令 handler 与工具共享同一套 user-tools 领域逻辑）。
 *
 * 零核心改动，纯插件挂载：注册 `conversation.input.right` 插槽条目
 * （order 50，紧跟附件/语音之后、发送按钮之前）。
 *
 * rc.7 兼容性：所需服务通过模块级 `inject` 数组声明（fiber 激活门控），
 * apply 内用 `ctx.get(name)` 读取；缺失时静默跳过（不阻塞会话其他能力）。
 *
 * 设置服务两代双轨：0.1.7 的 settings rewrite 删掉了浏览器端 `settingsScope`，
 * 配置面改由 `configForms` 提供（同名 namespace 的表单，快照/写入形状一致），
 * 设置页卡片插槽也从 `settings.plugin.item` 换到 Plugins 页的
 * `plugins.bundle.config`。两条轨道各注册一次、先到先得，因此 `settingsScope`
 * **不进**顶层 `inject`（否则会在新 harness 下永久 pending），只在嵌套
 * `ctx.inject([...])` 里按需等待。
 *
 * Context 服务类型增强在 `./runtime-augment.d.ts`：声明 `slots`/`sessions`/
 * `settingsScope`/`configForms`/`locale` 的最小契约，避免引入 `@deepseek-ai/dsh-client-*`
 * 这一族浏览器运行时包作为 NPM 依赖（它们是宿主注入产物，pnpm 解析预发布版
 * 会带来 hoisting/range 噪音）。
 * @module dsh-later/client
 */
import type { Context } from '@deepseek-ai/cordis';
// 宿主同款「本地绝对路径 → 媒体 URL」解析器（web: `<base>api/file?path=`，桌面:
// `dsh-app://app/api/file?path=`）。这是本文件开头那条「不引 dsh-client-* 运行时
// 包」例外的**例外**：它是纯字符串工具，没有服务/插槽身份，也不会因复制模块实例
// 而漂移主题——上游自己的 client bundle 同样把它内联进去（dsh-client-ui-chat
// lib/client.js 里有 `function fileMediaUrl` 的定义，而非 require）。走它而不是
// 自己拼 URL，是为了宿主将来收紧规则（如新增 scheme 白名单）时我们自动跟上。
import { fileMediaUrlCompat } from './workspace-path-compat.js';
import type { ClientConfigForm, ClientSettingsScope, LaterDockSeatProbe } from './runtime-augment.js';
import { name } from '../domain.js';
import { dictFor, LOCALE_IDS } from './locales/ui.js';
import { mergedFor } from './locales/settings.js';
import { injectStyles } from './styles.js';
import { isGroupBadgeVisible } from './schedule-facet.js';
import { mountLaterScheduleFacet } from './group-status-facet.js';
import { SchedButton } from './components/SchedButton.js';
import { ScheduleDock } from './components/ScheduleDock.js';
import { SchedulerSettingsCard } from './components/SchedulerSettingsCard.js';
import type { SchedButtonInjected } from './components/SchedButton.js';
import type { ScheduleDockInjected } from './components/ScheduleDock.js';
import type { ClientAttachment } from './types.js';
import { mountSessionPresence, type PresenceLocaleLike } from './session-presence.js';
import { mountBubbleMarker } from './marker-controller.js';
import type { LocaleFaceLike } from './useSchedT.js';
import {
  createScheduleSummaryStore,
  getScheduleSummaryStore,
  setActiveScheduleSummaryStore,
  type ScheduleSummarySessionsLike,
} from './schedule-summary-store.js';

/** Filled slot：输入框右侧工具行。 */
const INPUT_RIGHT_SLOT = 'conversation.input.right';

/** 所需服务：插槽注册 + 会话解析（命令通道需要 session face）。设置服务另走
 *  嵌套 `ctx.inject` 双轨等待，不在此列（见文件头）。 */
const inject = ['slots', 'sessions', 'conversation', 'locale'];

/** Locale 字典命名空间（locale 命名空间允许点分）。 */
const NS = 'settings.plugins.later';

/**
 * 编译期哨兵（issue #28）。
 *
 * dock 的词条能不能取到，取决于 `LocaleNamespaceMap` 的合并值是 **string 联合**
 * 而不是字典形状；写错的后果不是「编译不过」而是 `t` 吃掉所有 key 却返回 never，
 * 所以这里正向要求它为 `true`。断言体与它的局限（本仓无 slots 类型包 ⇒ 镜像断言）
 * 都写在 runtime-augment.d.ts。
 */
const _dockSeatProbe: LaterDockSeatProbe = true;
// 纯类型断言探针：只为让 tsc 校验插槽可赋值性，运行期无意义。
void _dockSeatProbe;

/** Settings 命名空间（必须与 host 端注册的字符串一致：dsh-later）。 */
const SETTINGS_NS = 'dsh-later';

/**
 * profile 里的**条目 id**（`cordis.patch.yml` 的 `id: later`）。
 *
 * 0.1.7+ 的 settings rewrite 用条目 id 而非 namespace 寻址表单：
 * - `configForms.get(entryId)`
 * - `SettingsForms.describe()` 的 `ns: entry.options.id`
 *
 * 用错不会报错，只会让设置页空白 —— 故与 `SETTINGS_NS` 分开命名、各司其职。
 */
const ENTRY_ID = 'later';

/**
 * 浏览器插件主体。
 * @param ctx - client 根上下文。
 */
/**
 * 浏览器插件主体。
 * @param ctx - client 根上下文。
 */
function apply(ctx: Context): void {
  const slots = ctx.get('slots');
  const sessions = ctx.get('sessions');
  const locale = ctx.get('locale');
  if (slots === undefined || sessions === undefined) return;

  // 样式注入（卸载清理）。
  ctx.effect(() => injectStyles(), 'dsh-later: styles');

  // 设置服务两代双轨：获取 clockIconStyle 设置
  // auto 模式根据 DSH 版本自动选择：0.2.0+ 用新版，0.1.x 用旧版
  // 检测方式：有 configForms 服务 = 0.2.0+，否则 = 0.1.x
  let detectedVersion: 'modern' | 'classic' = 'classic';
  let getClockIconStyle: () => 'auto' | 'modern' | 'classic' = () => 'auto';
  /**
   * 「在分组徽标中显示定时任务」当前取值（issue #83）。
   *
   * 默认 `true`，与 host `Config.showInGroupBadge` 的默认同源：两条设置轨道都还没绑上时
   * （宿主没有 settings 服务、或快照还在 loading），徽标照旧出现——一个还没读到的设置
   * 不该有「把用户的东西变没」这种权力。绑上轨道后由 {@link attachBadgeVisibility} 重指。
   */
  let getShowInGroupBadge: () => boolean = () => true;

  // 定时摘要 store（issue #17）：全插件唯一的定时任务数据权威。本插件的侧栏
  // badge 与外部插件（dsh-group-status 等，经 `require('dsh-later/client')`）
  // 读同一份摘要，因此 GroupLiveStatus 与行内 badge 永不漂移。
  // 卸载时先撤销登记再 dispose，避免消费方拿到已释放的 store。
  const summary = createScheduleSummaryStore(sessions as unknown as ScheduleSummarySessionsLike);
  setActiveScheduleSummaryStore(summary);
  ctx.effect(
    () => () => {
      if (getScheduleSummaryStore() === summary) setActiveScheduleSummaryStore(undefined);
      summary.dispose();
    },
    'dsh-later: schedule summary',
  );

  // 侧栏会话行「定时状态」badge（docs/ui/09 路线 B）：数据源为上面的摘要 store
  // （store 内部订阅 sessions.list 的行级 projectionValues——session.list 基线
  // 覆盖全会话，当前会话由投影帧实时推进——并周期 refresh() 读 RPC 补时效）。
  // 服务缺失时静默跳过。
  ctx.effect(
    () =>
      mountSessionPresence({
        summary,
        ...(locale === undefined ? {} : { locale: locale as unknown as PresenceLocaleLike }),
        getClockIconStyle: () => {
          const style = getClockIconStyle();
          if (style === 'auto') return detectedVersion;
          return style;
        },
      }),
    'dsh-later: presence',
  );

  /**
   * 注册 locale 字典（issue #28：dock 改用插槽 `t` seat 的前提）。
   *
   * 四条不可破坏的约定：
   *  1. **必须单次合并注册**。宿主对同一 NS 的同一 locale 二次 `register` 直接抛
   *     `locale namespace "…" already has locale "zh"`（dsh-client-locale
   *     client.js:1395），所以 dock/面板词条（`src/locales/ui.ts`）与设置卡词条
   *     （`src/locales/settings.ts`）必须在一个对象里给完，不能拆成两次注册——
   *     合并点就是 `mergedFor()`，本文件不再自己抄一遍词条。
   *
   *     8 门语言**一次给全**：宿主对缺失语言回退 `en`、再退到 key 本身，漏一门不报错，
   *     只静默降级。`LOCALE_IDS.map` 保证「宿主支持哪几种语言」与「注册了哪几种语言」
   *     这两个集合同源，加语言时不必回来找这个地方。
   *  2. **字典要先于任何使用 `t` 的插槽条目落位**。`ctx.effect` 的 execute 是同步跑的
   *     （cordis lib/index.js:1249 `task = this._execute(runner)` → :1141
   *     `runner.execute.call(this)`），本段又排在下方 dock 注册之前，故顺序成立。
   *     把本段挪到任何插槽注册之后就会破坏它——这里不做无谓搬移，靠注释钉住不变量。
   *  3. 顺序对了仍有两条真实路径会露裸 key，都与顺序无关，由 `useSchedT.schedTranslate`
   *     兜底：(a) 旧 renderer 不认条目的 `locale` 声明、压根不给 seat 的 `t`；
   *     (b) `locale === undefined` 的旧宿主组合——此时本段整块不执行。宿主
   *     `translate` 的链尾是 `?? key`：漏注册不报错，只把 key 名渲染到界面上。
   */
  if (locale !== undefined) {
    /**
     * 逐门展开成 `{zh: {...}, en: {...}, …}`。
     *
     * 不从 `LOCALE_IDS` 逐个展开、而是写成字面量 `{zh, en, ja, …}` 的话，日后往
     * `LOCALE_IDS` 加一门而忘了这里，宿主只会静默回退英文，没有任何报错——遍历让
     * 「支持的语言」与「注册的语言」两个集合没有分叉的机会。
     */
    const dicts = Object.fromEntries(LOCALE_IDS.map((id) => [id, mergedFor(id)]));
    ctx.effect(() => locale.register(NS, dicts), 'dsh-later: locale');
  }

  /**
   * 向 dsh-group-status 登记本插件的「定时任务」facet（issue #36）。
   *
   * 为什么是「我注册」而不是让对端继续适配：徽标上那个数字的语义（什么算紧急、要不要
   * 催用户、是几会话）一直归本插件，实现却写在对方仓库里——一方改口径，另一方不报错，
   * 只静默显示旧口径。现在语义与实现同源。facet id 与对端的过渡适配器**同名**
   * （`dsh-later.schedule`），同 id 由来源决胜（provider 恒胜 legacy），与两家 apply
   * 的先后无关：我们一登记，代管那份自动让位，不需要协调发布顺序。
   *
   * 三条不能打乱的约定：
   *  1. **排在 locale 注册之后**。`label` 经 `scheduledWord` 现读宿主 locale 服务；字典
   *     还没落位时，宿主对未注册的 key 是**原样回显键名**（链尾 `?? key`），于是徽标的
   *     `aria-label` 会念出 `facetScheduled` 这种裸键。`ctx.effect` 的 execute 同步跑
   *     （见上面 locale 段第 2 条），所以这一段的位置本身就是时序保证。
   *  2. **排在 summary 创建之后**。facet 直接绑这份 store——本插件的 store 与 apply 同批
   *     创建，不存在「store 迟到」那条路径（对端代管时才需要包一层登记面订阅）。
   *  3. **不进顶层 `inject`，也不写进 `dsh.client.external`**。dsh-group-status 是**可选**
   *     搭档：硬依赖会让本插件在对方缺席时卡在 pending、整个插件永不激活（issue #34
   *     那次 P0 就是顶层 inject 门控踩的坑）。对端缺席时 `registerLaterScheduleFacet`
   *     交回一个空操作注销函数，定时功能本身照常、console 无新增报错。
   *
   * 卸载时注销。对端 `remove(id, facet)` 只摘「当前登记的还是它」的那一份，所以热重载里
   * 新注册先于旧 dispose 也不会把新的摘掉。
   *
   * 显隐由本插件的 `showInGroupBadge` 决定（issue #83）：开 = 登记，关 = 注销。对端 #37
   * 废弃协议里的 `settingKey` 之后，「登记即显示，不注册即不显示」是唯一规则，消费方
   * 不再替任何来源保管开关，所以这个开关只能长在我们自己的卡片上、只能由我们执行。
   */
  const facetMount = mountLaterScheduleFacet({
    store: summary,
    scheduledWord: () => dictFor(locale?.getSnapshot().active).facetScheduled,
    enabled: () => getShowInGroupBadge(),
  });

  ctx.effect(
    () => {
      facetMount.refresh();
      return () => facetMount.dispose();
    },
    'dsh-later: group status facet',
  );

  /**
   * 把一条设置轨道接到徽标显隐上（issue #83）。
   *
   * 两代 harness 的 scope 形状一致（`getSnapshot` / `subscribe`），所以两条轨道都调这同一个
   * 函数；谁先到接谁，后到的只是换一个更近的读数来源。`refresh()` 以「登记着没有」这一个
   * 状态位判幂等，接两次也登记不出两份。
   *
   * 必须**订阅**而不能只在绑定时读一次：设置页保存后不刷新页面就要生效，而 apply 只跑一次。
   */
  const attachBadgeVisibility = (scope: ClientSettingsScope | ClientConfigForm): void => {
    getShowInGroupBadge = () => isGroupBadgeVisible(scope.getSnapshot());
    ctx.effect(
      () => scope.subscribe(() => facetMount.refresh()),
      'dsh-later: facet visibility setting',
    );
    // 绑定这一刻的快照可能还是 loading（→ 按默认显示）；订阅会在它变 ready 时再刷一次。
    facetMount.refresh();
  };

  /**
   * 执行一条 slash 命令（解析会话 face → command()）。
   *
   * 注意：commands 框架的 admission 语义只回 `{matched}`，handler 的业务结果
   * **不**经此返回（它落在会话记录里）。因此这里只能回答「是否受理」，调用方
   * 不得据此判断「业务是否真的发生了」——状态以 `userSchedules` 投影为准。
   */
  const callCommand: SchedButtonInjected['callCommand'] = async (sessionId, line) => {
    const actx = sessions.scope(sessionId as never);
    const face = actx === undefined ? undefined : sessions.sessionOf(actx);
    if (face === undefined) return { matched: false };
    try {
      const result = await face.command(line);
      return { matched: result?.ok === true && result.value?.matched === true };
    } catch {
      return { matched: false };
    }
  };

  /**
   * 把一条附件引用解析成浏览器可显示的 URL（issue #38）。
   *
   * 走宿主 `uiConversation.imageUrl(sessionId, ref)`。三点必须注意：
   *
   * 1. **`uiConversation` 绝不进模块级 `inject`**。顶层 inject 是 cordis 的**激活
   *    门控**：服务不来，整个入口永久 pending，`/later`、`/schedule`、
   *    `/user-schedule-*` 会集体消失——就是 issue #34 修掉的真实事故（宿主日志
   *    当时写的是 `later (dsh-later): pending (waiting for service: locale)`）。
   *    所以这里用 `ctx.get(...)` 可选取，取不到就 reject，由组件侧降级成
   *    「文字 + 文件 chip、无缩略图」，**不得**整块不渲染。
   * 2. **形状必须显式转换**：宿主收的是 camelCase 的 `ImageAttachmentRef`
   *    （`{attachmentId, mediaType, bytes, width, height}`），而 dock 手上是投影 wire
   *    的 snake_case `ClientAttachment`（`attachment_id` / `media_type` …）。直接把
   *    wire 对象丢进去，宿主按 `attachment.attachmentId` 取缓存键会拿到 `undefined`
   *    ——所有图片共用同一把键，表现为串图或永远加载不出来（静默错，比抛错难查）。
   * 3. **返回的 URL 是会话绑定的**：宿主内部是 `binding.session.readAttachment(...)`
   *    + `URL.createObjectURL`，绑定释放后会被 revoke。所以每次渲染重新解析是可接受
   *    的（宿主自己也有同名的 `peekImageUrl` 同步缓存路径），但组件侧必须带 `alive`
   *    标志，卸载后不能再 setState。
   *
   * 签名带 `sessionId` 而不是在 inject 里绑死：本仓的 `ClientSlotDeclaration.inject`
   * 镜像声明是 `() => object`（不收参数），而 `callCommand` 已经是「首参传 sessionId、
   * inject 零参」的既有形状（见上）。宿主自己的 queueDockEntry 走的是
   * `inject: (sessionId) => …`——那条路要先把镜像声明改宽才类型安全，属另一处修正。
   */
  const loadAttachmentUrl = (
    sessionId: string,
    ref: ClientAttachment,
  ): Promise<string> => {
    const face = ctx.get('uiConversation') as {
      imageUrl?(id: string, attachment: Record<string, unknown>): Promise<string>;
    } | undefined;
    if (typeof face?.imageUrl !== 'function') {
      return Promise.reject(new Error('later-dock: uiConversation.imageUrl unavailable'));
    }
    return face.imageUrl(sessionId, {
      attachmentId: ref.attachment_id,
      ...(ref.media_type !== undefined ? { mediaType: ref.media_type } : {}),
      ...(ref.bytes !== undefined ? { bytes: ref.bytes } : {}),
      ...(ref.width !== undefined ? { width: ref.width } : {}),
      ...(ref.height !== undefined ? { height: ref.height } : {}),
    });
  };

  /**
   * 同步取宿主缓存里的图片 URL（`uiConversation.peekImageUrl`）。命中时 dock 无需发请求、
   * 也不会撞上「未被会话引用」的拒绝；未命中返回 undefined，交给 `loadAttachmentUrl`。
   */
  const peekAttachmentUrl = (sessionId: string, ref: ClientAttachment): string | undefined => {
    const face = ctx.get('uiConversation') as {
      peekImageUrl?(id: string, attachment: Record<string, unknown>): string | undefined;
    } | undefined;
    if (typeof face?.peekImageUrl !== 'function') return undefined;
    return face.peekImageUrl(sessionId, {
      attachmentId: ref.attachment_id,
      ...(ref.media_type !== undefined ? { mediaType: ref.media_type } : {}),
    });
  };

  /**
   * 把内核带出的 `host_path` 换算成浏览器可显示的 URL（宿主 `GET /api/file`）。
   *
   * 这条是**待发附件唯一**能出图的路：附件在代发前不被会话日志引用，
   * `imageUrl` / `peekImageUrl` 那条要求「已被本会话引用」，必然被拒。
   *
   * `document.baseURI` 在**调用时**读而不是在模块顶层读：客户端 bundle 可能在
   * 文档定稿前被求值，且桌面载体走 `dsh-app://app/` 基址——两种形态由宿主
   * `fileMediaUrl` 自己判别，非法基址或非法路径它返回 `undefined`，组件据此降级。
   */
  const localMediaUrl = (path: string): string | undefined => fileMediaUrlCompat(document.baseURI, path);

  /**
   * 待发送提醒 dock（对齐 QueueDock 呈现；排在排队消息之后）。只依赖命令通道，
   * 不依赖设置服务，因此在顶层无条件注册。
   *
   * `locale: NS` 让宿主渲染器把 `t` 挂进标准件（dsh-client-ui-renderer
   * lib/client.js:727-731 `kit["t"] = localeSeat(face, entry.locale)`），dock 因此
   * 不再需要注入原始 `locale` 服务；seat 的 `t` 会随宿主 locale revision 换引用
   * （同文件 :528-542 的缓存），语言切换自动重渲染，无需组件内自行订阅。
   *
   * ⚠️ 声明 `locale` 的前提是模块级 `inject` 数组里 `locale` 还在（本文件顶部）：
   * 渲染器在 face 缺失时是**抛 SlotAssemblyError**，不是静默跳过。那条 inject 是
   * fiber 激活门控——没有 locale 服务的旧宿主根本不会激活本插件，dock 也就不注册，
   * 所以这里不会炸。若日后把 `locale` 从 inject 里摘掉，必须同时退回手动注入。
   */
  ctx.slots.inject(
    'conversation.input.dock',
    () =>
      ctx.slots.register(
        {
          name: 'conversation.input.dock',
          id: 'later-dock',
          order: 30,
          locale: NS,
          // `loadImage` 是**可选**注入：内部按 `ctx.get('uiConversation')` 取，取不到
          // 时组件自动降级（见 loadAttachmentUrl 的注释）。它不构成激活依赖，所以 dock
          // 仍在顶层无条件注册——**不要**因此把 `uiConversation` 加进模块级 inject。
          // `localMediaUrl` 不依赖任何服务（纯字符串换算 + document.baseURI），因此
          // 待发附件的缩略图在「宿主没有 uiConversation face」这种旧组合下也能出图。
          inject: () => ({
            callCommand,
            loadImage: loadAttachmentUrl,
            peekImage: peekAttachmentUrl,
            localMediaUrl,
          } as ScheduleDockInjected),
        },
        ScheduleDock,
      ),
  );

  /** 输入框按钮是否已挂载：两条设置轨道只会命中一条，重复挂载会出现两颗按钮。 */
  let composerMounted = false;

  /**
   * 挂载输入框右侧按钮（其面板订阅智能时段配置，故需要设置 scope）。
   * @param scope - 本插件 namespace 的设置面（旧 `settingsScope` 或新 `configForms`）。
   */
  const mountComposer = (scope: ClientSettingsScope | ClientConfigForm): void => {
    if (composerMounted) return;
    composerMounted = true;
    ctx.slots.inject(
      INPUT_RIGHT_SLOT,
      () =>
        ctx.slots.register(
          {
            name: INPUT_RIGHT_SLOT,
            id: 'later',
            order: 50,
            inject: () => ({ callCommand, locale, schedulerScope: scope } as SchedButtonInjected),
          },
          SchedButton,
        ),
    );
  };

  /** 气泡标记是否已挂载：两条设置轨道只会命中一条，重复注册会占两次 priority。 */
  let markerMounted = false;

  /**
   * 挂载定时消息气泡标记（issue #112）。
   *
   * `off` 由 marker-controller 自己收敛为「不注册」；能力门禁（0.2.1+ 的
   * `conversation.chat.node` + 用户内容工厂）也在那里，所以这里只负责接线一次。
   * @param scope - 本插件 namespace 的设置面（旧 `settingsScope` 或新 `configForms`）。
   */
  const mountMarker = (scope: ClientSettingsScope | ClientConfigForm): void => {
    if (markerMounted) return;
    markerMounted = true;
    ctx.effect(
      () =>
        mountBubbleMarker({
          slots,
          scope,
          ...(locale === undefined ? {} : { locale: locale as unknown as LocaleFaceLike }),
        }),
      'dsh-later: bubble marker',
    );
  };

  /** 设置卡文案取值器；locale 服务缺失时卡片不注册（按钮自带回退，仍可挂载）。 */
  const cardT = locale === undefined ? undefined : locale.bind(NS);

  /** 设置页卡片声明（两代 harness 仅插槽名不同）。 */
  const cardDeclaration = (slot: string, scope: ClientSettingsScope | ClientConfigForm, surface: 'detail' | 'settings' = 'detail') => ({
    name: slot,
    id: SETTINGS_NS,
    order: 30,
    key: SETTINGS_NS,
    locale: NS,
    label: () => {
      const active = locale === undefined ? 'zh' : locale.getSnapshot().active;
      return active === 'en' ? 'Session Scheduler' : '定时提醒';
    },
    inject: () => ({ scope, t: cardT, surface }),
  });

  // 旧 harness（≤ 0.1.5）：浏览器端 settingsScope + 设置页 settings.plugin.item。
  ctx.inject(['settingsScope'], () => {
    const binder = ctx.get('settingsScope');
    if (binder === undefined) return;
    // 旧版本（0.1.x）使用旧版点阵时钟
    detectedVersion = 'classic';
    const scope = binder.bind({ namespace: SETTINGS_NS });
    // 更新 getClockIconStyle 函数，从 scope 中读取 clockIconStyle 设置
    getClockIconStyle = () => {
      const snap = scope.getSnapshot();
      if (snap.status !== 'ready') return 'auto';
      const value = (snap.value ?? {}) as Record<string, unknown>;
      const style = value['clockIconStyle'];
      return style === 'modern' || style === 'classic' ? style : 'auto';
    };
    // 徽标显隐开关接到这条设置轨道上（issue #83）：保存即生效，不依赖刷新页面。
    attachBadgeVisibility(scope);
    mountComposer(scope);
    mountMarker(scope);
    if (cardT === undefined) return;
    // 设置对话框中的设置页：默认不显示，由插件详情页的开关控制。
    // 开关状态存储在 localStorage 中，key 为 'dsh-later:show-settings-section'。
    const SHOW_SETTINGS_KEY = 'dsh-later:show-settings-section';
    const showSettingsSection = typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_SETTINGS_KEY) === 'true';
    if (!showSettingsSection) return;
    const disposeSection = ctx.slots.inject('settings.section', () =>
      ctx.slots.register(cardDeclaration('settings.section', scope, 'settings'), SchedulerSettingsCard),
    );
    if (typeof disposeSection === 'function') {
      ctx.effect(() => () => {
        disposeSection();
      });
    }
  });

  // 新 harness（0.1.7+ settings rewrite）：configForms 表单 + Plugins 页
  // `plugins.bundle.config` 卡片。该插槽由宿主按「条目确被服务」渲染，故用
  // whileServed 等宿主 describe 里出现本插件**条目 id** 再注册（撤服时连带注销）。
  //
  // ⚠️ 寻址键是**条目 id**（`cordis.patch.yml` 的 `id: later`），不是 settings
  // namespace（'dsh-later'）：`configForms.get(entryId)` 与 describe() 的
  // `ns: entry.options.id` 都用条目 id。宿主 describe() 直接从
  // `entry.fiber.runtime.Config` 生成表单，而 `ns` 即条目 id——用错会静默拿到
  // 空表单（设置页空白、无报错）。这正是 0.2.0 下卡片不显示的原因之一。
  ctx.inject(['configForms'], () => {
    const forms = ctx.get('configForms');
    if (forms === undefined || typeof forms.get !== 'function' || typeof forms.whileServed !== 'function') return;
    // 新版本（0.2.0+）使用新版描边时钟
    detectedVersion = 'modern';
    const scope = forms.get(ENTRY_ID);
    // 更新 getClockIconStyle 函数，从 configForms scope 中读取 clockIconStyle 设置
    getClockIconStyle = () => {
      const snap = scope.getSnapshot();
      if (snap.status !== 'ready') return 'auto';
      const value = (snap.value ?? {}) as Record<string, unknown>;
      const style = value['clockIconStyle'];
      return style === 'modern' || style === 'classic' ? style : 'auto';
    };
    // 徽标显隐开关接到这条设置轨道上（issue #83）：保存即生效，不依赖刷新页面。
    attachBadgeVisibility(scope);
    mountComposer(scope);
    mountMarker(scope);
    if (cardT === undefined) return;
    ctx.effect(
      () =>
        forms.whileServed([ENTRY_ID], () =>
          ctx.slots.inject('plugins.bundle.config', () =>
            ctx.slots.register(cardDeclaration('plugins.bundle.config', scope, 'detail'), SchedulerSettingsCard),
          ),
        ),
      'dsh-later: plugins-page card',
    );
    // 设置对话框中的设置页：默认不显示，由插件详情页的开关控制。
    // 开关状态存储在 localStorage 中，key 为 'dsh-later:show-settings-section'。
    const SHOW_SETTINGS_KEY = 'dsh-later:show-settings-section';
    const showSettingsSection = typeof localStorage !== 'undefined' && localStorage.getItem(SHOW_SETTINGS_KEY) === 'true';
    if (!showSettingsSection) return;
    const disposeSection = ctx.slots.inject('settings.section', () =>
      ctx.slots.register(cardDeclaration('settings.section', scope, 'settings'), SchedulerSettingsCard),
    );
    if (typeof disposeSection === 'function') {
      ctx.effect(() => () => {
        disposeSection();
      });
    }
  });
}

export { apply, inject, name };

// ── 跨插件公共 API（issue #17）──────────────────────────────────────────────
//
// 消费方（如 dsh-group-status）在 package.json 声明
// `"dsh.client": { "external": ["dsh-later"] }` 后，在客户端 factory 里
// `require('dsh-later/client')` 即可拿到下面这组导出：
//
//   const later = require('dsh-later/client')
//   const store = later.getScheduleSummaryStore()          // 可能为 undefined（未加载）
//   later.summarizeScheduleGroup(store.getSnapshot(), ids) // 分组聚合
//
// 或直接读 React hook：`later.useScheduleSummary()`。
export {
  buildScheduleSummary,
  schedulesOfProjection,
  summarizeScheduleGroup,
} from './schedule-summary.js';
export {
  createScheduleSummaryStore,
  getScheduleSummaryStore,
  subscribeScheduleSummaryStore,
} from './schedule-summary-store.js';
export { useScheduleSummary } from './useScheduleSummary.js';

// ── issue #158 的测试面 ─────────────────────────────────────────────────────
//
// 面板锚定后端（`hook` / `css-anchor` / `static`）是**模块加载期**算出的常量：想对不同的
// 宿主导出面断言分派结论，只能在加载时换掉 primitives 的桩，再对同一份导出面重算一遍。
// 纯函数，无副作用、不进任何渲染路径；`tests/panel-anchor-backends.test.mjs` 是唯一消费者。
export { __panelAnchorProbeForTest } from './primitives-compat.js';

export type {
  GroupScheduleSummary,
  ScheduleSummaryEntry,
  ScheduleSummaryMap,
  ScheduleSummarySource,
} from './schedule-summary.js';
export type {
  ScheduleSummarySessionsLike,
  ScheduleSummaryStore,
  ScheduleSummaryStoreOptions,
} from './schedule-summary-store.js';
