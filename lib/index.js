import s from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { userSchedulesProjectionUnit } from './projection.js';
import { registerUserScheduleCommands } from './commands.js';
import { UserScheduleRuntime } from './runtime.js';
import { DEFAULT_MAX_PROMPT_CHARS, DEFAULT_MAX_SCHEDULES, resolvePromptLimits, userScheduleCreate, userScheduleDelete, userScheduleList, } from './user-tools.js';
import { name, SETTINGS_NAMESPACE } from './domain.js';
import { checkKernelIdentityAtStartup } from './kernel-identity.js';
import { createRuntimeRegistry } from './runtime-registry.js';
import { hostDictFor, hostFormat } from './strings.js';
/** 插件配置 schema（全可选，默认开箱即用；经 cordis config 覆盖）。 */
/**
 * 插件配置 schema（**单一事实来源**）。
 *
 * 0.2.0 起 `ctx.settings.describe()` 直接读 `entry.fiber.runtime.Config`
 * （见 dsh-settings `schema(entry)`：「`entry.fiber?.runtime?.Config`，且需有
 * `toJSON`」），据此生成该插件设置页的表单。因此**可编辑字段必须全部声明在
 * `Config` 上**——只放在 `SchedulerSettingsSchema` 里的字段在 0.2.0 下不会
 * 出现在设置 UI 中。
 *
 * 历史：0.1.5 用 `settingsProvider.register(ns, schema, …)` 注册一个**独立于
 * Config 的** schema（即 `SchedulerSettingsSchema`），0.1.7 删除了该 API。
 * 两代并存期间两份 schema 内容一致，现统一为 `Config` 一份，`SchedulerSettingsSchema`
 * 保留为别名以免大范围改动调用点。
 */
export const Config = s.object({
    /** 单 session 用户任务上限。 */
    maxSchedules: s.number().step(1).min(1).default(DEFAULT_MAX_SCHEDULES),
    /** 是否解除提示字符的默认上限（1000）；关闭时 maxPromptChars 不生效。 */
    allowLongPrompts: s.boolean().default(false),
    /** 提示字符上限（≥1 整数）；仅在 allowLongPrompts=true 时生效。 */
    maxPromptChars: s.number().step(1).min(1).default(DEFAULT_MAX_PROMPT_CHARS),
    /** 是否显示输入框右侧的定时按钮（仅 GUI 显隐；提醒触发与 dock 不受影响）。 */
    showButton: s.boolean().default(true),
    /**
     * 插话投递方式（「插话发送」把提醒内容推给 agent 时进哪个队列）。
     *
     * - `followup`：入 `next-turn`，**独立成一轮**（等价于「正常发送」）。`next-turn`
     *   与 `next-step` 是两条独立队列，核心的 `claim('next-step', …)` 不触碰它，
     *   因此**不存在**与 `turn/start` 竞争而被吞的窗口。默认。
     * - `steer`：入 `next-step`，在下一个 step 边界消费，更快；但若插话恰好撞上
     *   `turn/start`，核心的 `claim` 会把整批 `next-step` 取走并交给一个**请求上下文
     *   已定**的 step，消息会落进 surface 却不进实际请求 —— 静默丢失（实测复现见
     *   runtime.steerById 注释）。
     */
    steerDelivery: s.union([s.const('followup'), s.const('steer')]).default('followup'),
    /**
     * 投递确认：投递后核对会话日志中是否出现该 message id。
     *
     * 关闭则恢复 fire-and-forget（不读日志、不保证送达）。
     */
    confirmDelivery: s.boolean().default(true),
    /**
     * 投递未确认时的处理。
     *
     * - `keep`：**不写 dispatch**，条目留在 active 可重试（配合确认默认开启，使
     *   `steer` 由「会丢」降级为「需重试」）。默认。
     * - `discard`：按旧语义写 dispatch 出列 —— 注意这会让静默丢失重新变得可能，
     *   仅供明确需要旧行为的场景。
     */
    onUnconfirmed: s.union([s.const('keep'), s.const('discard')]).default('keep'),
    /**
     * 时钟图标风格。
     *
     * - `auto`：按 DSH 内核版本自动选择（0.2.0+ 用新版官方描边风格，0.1.x 用旧版点阵风格）。默认。
     * - `modern`：强制使用新版官方描边风格（24×24 stroke 圆头线帽）。
     * - `classic`：强制使用旧版点阵风格（10×10 fill 方块 crispEdges）。
     */
    clockIconStyle: s.union([s.const('auto'), s.const('modern'), s.const('classic')]).default('auto'),
    /**
     * 高级语法（**Beta**，默认开启）：`/later` 与 `/schedule` 的多次写法。
     *
     * 覆盖三种写法：等间隔重复 `+1h*3`、相对链式序列 `+1h+1h+0.5h`、绝对锚点序列
     * `15:32+16:32` / `9:00+1d`。标 Beta 的理由不是"没测"（38 个单测已覆盖），而是
     * **展开语义还没被真实使用验证过**：一次命令写 10 条任务会不会刷屏 dock、
     * 60 秒地板与 10 条上限的尺度是否合适，都需要一段观察期。
     *
     * 关闭后这些写法被**明确拒绝**并提示来设置页开启——不会退回"静默建成一条乱码"
     * 的旧行为：那是 bug，不属于可回退的功能面。残片守卫（`15:32*3`、`+1h..3h`）
     * 与本开关无关，始终生效。
     */
    advancedSyntax: s.boolean().default(true),
}).volatile();
/**
 * 0.1.5 时代 settings namespace 注册所用的 schema。
 *
 * 与 {@link Config} 同源（同一 schema 对象）：0.1.5 的
 * `settingsProvider.register()` 需要显式传入，而 0.2.0 的 `describe()` 只认
 * `Config`。保留此别名让两代共用一份定义，避免两份 schema 漂移。
 */
const SchedulerSettingsSchema = Config;
/**
 * 所需服务（延后激活，缺失时插件不加载）。
 *
 * ⚠️ 这里**只能列 host 平面存在的服务**。`locale` 是 client 侧服务
 * （`@deepseek-ai/dsh-client-locale`），在 agent/host 平面上永远不出现：一旦列进
 * 这份顶层 inject，cordis 的激活门控会让整个入口永久 `pending`，日志表现为
 * `later (dsh-later): pending (waiting for service: locale)`，连带 `/later`、
 * `/schedule`、`/user-schedule-*` 全部消失（b7fc4b7 就这么炸过一次）。
 * 需要语言时走 `ctx.get('locale')?.getSnapshot().active`——那三处消费点本来就是
 * 可选链，拿不到就走默认语言，而不是让整个插件不加载。
 * 同一条纪律在本仓 client 入口的文件头也写着（`src/client/index.tsx`：「**不进**
 * 顶层 `inject`，否则会永久 pending」）。
 */
export const inject = ['agents', 'sessions', 'tools', 'commands', 'settings'];
/** 解析配置（容错非法值回落默认）。 */
function resolveMaxSchedules(value) {
    if (typeof value !== 'number' || value < 1)
        return DEFAULT_MAX_SCHEDULES;
    return Math.floor(value);
}
/**
 * 本插件在 profile 里的**条目 id**。
 *
 * 必须与 `cordis.patch.yml` 的 `id:` 一致：0.2.0 的 `configForms.get(entryId)`
 * 与 `SettingsForms.describe()` 的 `ns` 都用条目 id 寻址，用错会静默拿不到
 * 表单/值（设置页空白，无报错）。
 */
const ENTRY_ID = 'later';
/** 根据 settings 计算当前生效的提示字符上限（与 user-tools.resolvePromptLimits 同源）。 */
function resolveSchedulerPromptLimits(settings) {
    return resolvePromptLimits({
        allowLongPrompts: settings.allowLongPrompts,
        maxPromptChars: settings.maxPromptChars,
    });
}
/** 纯泛化等待卡片（GenericCallView）。 */
function present(title, kind, rawInput) {
    return {
        card: 'generic',
        title,
        kind,
        ...(rawInput === undefined ? {} : { rawInput }),
    };
}
/** 渲染工具结果：JSON 文本。 */
function renderText(_args, value) {
    return [{ type: 'text', text: value }];
}
/** 为单个 root agent 注册 `user_schedule_*` 工具。 */
function registerUserScheduleTools(rootCtx, toolCtx, agent, getSettings, getLocale, onUserChange) {
    const dispose = () => undefined;
    try {
        const t = hostDictFor(getLocale());
        const maxChars = resolveSchedulerPromptLimits(getSettings()).maxChars;
        const disposers = [
            toolCtx.tools.register(defineTool({
                name: 'user_schedule_create',
                // description 在每次 register 时按当前 settings + locale 生成：
                // 模型看到的字符上限始终与宿主实际校验一致，避免描述与实现脱节。
                description: t.toolCreateDesc,
                parameters: {
                    prompt: {
                        type: 'string',
                        required: true,
                        description: hostFormat(t.paramPromptDesc, { maxChars }),
                    },
                    after_seconds: { type: 'number', description: t.paramAfterSecondsDesc },
                    every_seconds: { type: 'number', description: t.paramEverySecondsDesc },
                    at: {
                        description: t.paramAtDesc,
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    date: { type: 'string', required: true },
                                    time: { type: 'string', required: true },
                                    time_zone: { type: 'string', required: true },
                                },
                            },
                        ],
                    },
                    time_zone: { type: 'string', description: t.paramTimeZoneDesc },
                },
                output: {
                    schema: { type: 'string' },
                    render: renderText,
                },
                async execute(args, exec) {
                    if (exec.agent !== agent)
                        return JSON.stringify({ ok: false, code: 'internal_error', message: '操作失败。' });
                    const settings = getSettings();
                    const result = await userScheduleCreate(args, agent, rootCtx, settings.maxSchedules, undefined, resolveSchedulerPromptLimits(settings));
                    if (result.ok) {
                        try {
                            onUserChange(agent);
                        }
                        catch {
                            /* 通知失败不影响结果 */
                        }
                    }
                    return JSON.stringify(result);
                },
                presentCall: (args) => present(t.presentCreate, 'other', args?.prompt),
            })),
            toolCtx.tools.register(defineTool({
                name: 'user_schedule_list',
                description: t.toolListDesc,
                parameters: {},
                output: {
                    schema: { type: 'string' },
                    render: renderText,
                },
                async execute(_args, exec) {
                    if (exec.agent !== agent)
                        return JSON.stringify({ ok: false, code: 'internal_error', message: '操作失败。' });
                    const result = await userScheduleList(agent);
                    return JSON.stringify(result);
                },
                presentCall: () => present(t.presentList, 'read'),
            })),
            toolCtx.tools.register(defineTool({
                name: 'user_schedule_delete',
                description: t.toolDeleteDesc,
                parameters: {
                    id: { type: 'string', required: true, description: t.paramIdDesc },
                },
                output: {
                    schema: { type: 'string' },
                    render: renderText,
                },
                async execute(args, exec) {
                    if (exec.agent !== agent)
                        return JSON.stringify({ ok: false, code: 'internal_error', message: '操作失败。' });
                    const result = await userScheduleDelete(args.id, agent, rootCtx);
                    if (result.ok && result.deleted) {
                        try {
                            onUserChange(agent);
                        }
                        catch {
                            /* 通知失败不影响结果 */
                        }
                    }
                    return JSON.stringify(result);
                },
                presentCall: (args) => present(t.presentDelete, 'other', args?.id),
            })),
        ];
        return () => {
            for (const disposeOne of disposers.reverse())
                disposeOne();
        };
    }
    catch (error) {
        dispose();
        rootCtx.logger.warn(`later: user tools 注册失败: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}
/**
 * Cordis 函数插件主体。
 * @param ctx - 全局服务上下文。
 * @param config - 可选配置（maxSchedules）。
 */
/** 插件卸载中的标记（避免继续接受新 agent 挂载）。 */
let stopping = false;
export function apply(ctx, config) {
    // P0-2：cordis 在配置变更/重载时会 teardown 后再次 apply。stopping 是模块级
    // 标志，若不复位，第二次 apply 起所有 agent 都会在 agent/created 处早退，
    // 用户工具与调度器静默不挂载（GUI 无按钮、提醒永不触发）。
    stopping = false;
    // yml 启动配置仅在首次解析时生效（与运行时用户设置正交，参见
    // dsh-smooth-stream 等同款做法）：用户在设置页保存的值走自己的 user 层，
    // 不与 yml base 混合。命令/工具每次调用通过 getSettings() 按需读取设置层的
    // maxSchedules（设置未保存则回退 yml/默认）。
    const startMaxSchedules = resolveMaxSchedules(config?.maxSchedules);
    // 0. 内核模块同源护栏（issue #57）：link: 开发态下插件可能解析到自己的
    //    @deepseek-ai/dsh-* 实例（自己 node_modules/.pnpm），而宿主用的是 dsh
    //    安装目录那份，两份模块级状态互不可见。历史上这里还有一步「把自有会话
    //    事件类型 add 进 KNOWN_SESSION_EVENT_TYPES」的读兼容注册，已随 #58 移除：
    //    上游明确否决了事件名注册这条路（读会变成 composition-dependent），
    //    兼容机制是 envelope 的 `ignorable: true`，旧日志改由
    //    scripts/migrate-owned-events.mjs 一次性迁移。护栏只观测、不修复。
    checkKernelIdentityAtStartup();
    // 1. `userSchedules` 会话投影（GUI 读状态）。
    // `as never`：本插件 dev 依赖解析到的 @deepseek-ai/dsh-session-projection
    // 可能是旧版（rc.1，契约 `schema`+顶层 `view`），而宿主运行时是 rc.2
    // （契约 `stateSchema`+`wire{viewSchema,view}`）。两者在类型层冲突，
    // 直接类型化注册会被旧版契约拒掉；运行时又必须按 rc.2 传。故此处保留
    // `as never` 显式声明「运行时契约以宿主为准」，并用
    // `tests/projection-unit.test.mjs` 在运行时锁定 rc.2 形状，防止回归。
    ctx.inject(['sessionProjections'], (projectionCtx) => {
        projectionCtx.sessionProjections.register(userSchedulesProjectionUnit);
    });
    // 2. 注册 settings namespace（设置 - 插件 配置 UI）。
    // 拿住 owner scope：`applies: 'live'` 声明改动即时生效。工具/命令 handler
    // 每次调用通过 getSettings() 按需读取——避免主动 watch 引入的一致性边界与
    // 误同步（对齐 dsh-smooth-stream / dsh-auto-collapse 的写法）。
    const startSettings = {
        maxSchedules: startMaxSchedules,
        allowLongPrompts: false,
        maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
        steerDelivery: 'followup',
        confirmDelivery: true,
        onUnconfirmed: 'keep',
        clockIconStyle: 'auto',
        // Beta 功能默认开：语法已经过 38 个单测，关闭它只会把用户推向报错。
        advancedSyntax: true,
    };
    let getSettings = () => startSettings;
    ctx.inject(['settings'], (settingsCtx) => {
        // 0.1.7 移除了整个 `settings.yaml` 体系：`SettingsProvider.register()` 不复存在，
        // `ctx.settings` 变成 `SettingsForms`（只有 configure/describe/prepareDocument），
        // 命名空间 schema 改为**由 profile 声明驱动**（见 0.1.7 dsh-settings 的类型注释
        // “Move the sections of the removed settings.yaml into the active profile”）。
        //
        // 照旧调用会抛错并让整个 settings 注入失败，因此这里做代次探测：拿不到
        // `register` 就保持 `startSettings`（即 profile yml 的 `base` 值），
        // 插件功能不受影响，只是不再支持运行时热改设置。
        //
        // TODO(0.1.7 配置迁移)：把 SchedulerSettingsSchema 迁到 profile 声明式配置，
        // 恢复 GUI 设置页与 live 生效。这是跨 15 个插件的架构课题，单独排期。
        //
        // 类型收窄：0.1.5 的 `SettingsProvider` 有 `register`，0.1.7 的 `SettingsForms`
        // 没有——直接用联合类型会让两代都无法通过编译，故按「本插件所需的最小面」
        // 声明本地接口，再对运行时对象做一次存在性判断。
        const provider = settingsCtx.settings;
        /**
         * 把「settings 原始值」规整为运行时设置（容错非法值回落默认）。
         * 三条代次轨道共用，避免各处重复解析逻辑。
         */
        const readSettings = (value) => ({
            maxSchedules: resolveMaxSchedules(value?.maxSchedules ?? startSettings.maxSchedules),
            allowLongPrompts: value?.allowLongPrompts === true,
            maxPromptChars: typeof value?.maxPromptChars === 'number' && value.maxPromptChars >= 1
                ? Math.floor(value.maxPromptChars)
                : startSettings.maxPromptChars,
            // 非法/缺失回落默认：投递方式默认 followup（安全侧），确认默认开，
            // 未确认默认保留（不丢消息）。
            steerDelivery: value?.steerDelivery === 'steer' ? 'steer' : 'followup',
            confirmDelivery: value?.confirmDelivery !== false,
            onUnconfirmed: value?.onUnconfirmed === 'discard' ? 'discard' : 'keep',
            clockIconStyle: value?.clockIconStyle === 'modern' || value?.clockIconStyle === 'classic'
                ? value.clockIconStyle
                : 'auto',
            // 仅显式 false 关闭；缺失/非法一律按默认开（与 schema 的 default(true) 同源）
            advancedSyntax: value?.advancedSyntax !== false,
        });
        // ── 轨道 1：0.2.0（settings rewrite 第二版）─────────────────────────────
        //
        // 0.2.0 的 `ctx.settings` 是 `SettingsForms`，**没有 `register()`**；表单由
        // `describe()` 从 `entry.fiber.runtime.Config`（即本插件导出的 `Config`）
        // 自动生成，值来自该 profile 条目已合并的 `config`。
        //
        // 因此这一代**无需注册**：字段已在 `Config` 上声明，宿主自会渲染设置页。
        // 插件侧只需读取「当前生效配置」。但 `Config` 的默认值由 cordis 在构造时
        // 填充，运行中热改需从 describe() 快照取——故这里订阅 document 更新事件，
        // 把最新值同步进 getSettings，实现与 0.1.5 相同的 `applies: 'live'` 语义。
        const forms = settingsCtx.settings;
        if (typeof provider.register !== 'function' && typeof forms.describe === 'function') {
            const describeValue = () => {
                try {
                    // entry id = profile 条目 id（`cordis.patch.yml` 的 `id: later`），
                    // **不是** settings namespace（'dsh-later'）——见 dsh-settings
                    // describe()：`ns: entry.options.id`。
                    const row = forms
                        .describe?.({ redactSecrets: true })
                        .find((candidate) => candidate.ns === ENTRY_ID);
                    return row?.value;
                }
                catch {
                    return undefined;
                }
            };
            getSettings = () => readSettings(describeValue());
            // 文档更新 → 重新取值（宿主在 describe 检测到变化时发该事件）。
            settingsCtx.on('settings/document-updated', (ns) => {
                if (ns !== ENTRY_ID && ns !== SETTINGS_NAMESPACE)
                    return;
                getSettings = () => readSettings(describeValue());
            });
            return;
        }
        // ── 轨道 2：0.1.5 及更早（settings.yaml 体系）──────────────────────────
        if (typeof provider.register !== 'function')
            return;
        const scope = provider.register(
        // 断言而非 settingsNamespace()：0.1.1 要求 branded 类型，0.1.2 已删除该 helper。
        SETTINGS_NAMESPACE, SchedulerSettingsSchema, { applies: 'live' });
        getSettings = () => {
            try {
                return readSettings(scope.get());
            }
            catch {
                return startSettings;
            }
        };
    });
    // 每个 root agent 一个「用户提醒调度器」：负责确保命令/工具创建的提醒会武装 timer 并触发。
    // 每个 root agent 一个「用户提醒调度器」。挂载规则全部在 runtime-registry.ts
    //（幂等 / 只认 root / 水合 / 自愈 / teardown 守卫，且有行为级测试），这里只做接线。
    const runtimeRegistry = createRuntimeRegistry({
        roots: () => ctx.agents.roots(),
        isStopping: () => stopping,
        create: (agent) => new UserScheduleRuntime(ctx, agent, getSettings),
        drive: (runtime) => runtime.requestDrive(),
        warn: (message) => ctx.logger.warn(message),
        attach: (agent, runtime) => {
            // effect 的 disposer 由 agent.ctx 生命周期托管，这里不需要自己持有。
            agent.ctx.effect(() => {
                const getLocale = () => ctx.get('locale')?.getSnapshot().active;
                const disposeTools = registerUserScheduleTools(ctx, agent.ctx, agent, getSettings, getLocale, notifyUserChange);
                const stopStatus = agent.ctx.on('agent/status', ({ status }) => {
                    // 自愈：agent 转 idle 时重算（与 dsh-schedule 同构），覆盖被遗漏的重驱。
                    if (status === 'idle')
                        runtime.requestDrive();
                });
                runtime.requestDrive();
                return async () => {
                    stopStatus();
                    disposeTools();
                    try {
                        await runtime.dispose();
                    }
                    finally {
                        runtimeRegistry.forget(agent, runtime);
                    }
                };
            }, 'later.userTools()');
        },
    });
    /** 用户创建/删除成功 → 重驱该 agent 的调度器（缺挂载时自愈补挂，见注册表）。 */
    const notifyUserChange = (agent) => {
        try {
            runtimeRegistry.drive(agent);
        }
        catch {
            /* 调度失败不影响工具/命令的结果 */
        }
    };
    /** 用户主动插话（GUI「插话发送」按钮）：路由到该 agent 的 runtime。 */
    const notifyUserSteer = async (agent, id) => {
        // ensure 会先自愈；自愈不了（非 root / teardown / attach 失败）才如实报错。
        const runtime = runtimeRegistry.ensure(agent);
        if (runtime === undefined) {
            return { ok: false, code: 'no_runtime', message: '该会话尚未挂载用户调度器。' };
        }
        return runtime.steerById(id);
    };
    // 2. slash 命令（客户端变更通道），全局注册一次。
    ctx.effect(() => {
        const getLocale = () => ctx.get('locale')?.getSnapshot().active;
        return registerUserScheduleCommands(ctx, getSettings, notifyUserChange, notifyUserSteer, getLocale);
    }, 'later.commands()');
    // 3. 每个 root agent：注册用户工具 + 用户调度器生命周期。
    ctx.effect(() => {
        // 0.1.7 起 `agent/created` 是**异步串行**事件：回调须返回 Promise，且首次
        // 模型请求会等待初始化完成。0.1.5/0.1.2 的同步回调签名在 0.1.7 下会因
        // 返回 void 而不匹配，故显式 async。
        const stopCreated = ctx.on('agent/created', async ({ agent }) => {
            runtimeRegistry.mount(agent);
        });
        return async () => {
            stopping = true;
            stopCreated();
            const drained = runtimeRegistry.drain();
            await Promise.allSettled(drained.map((runtime) => runtime.dispose()));
        };
    }, 'later.userToolsLifecycle()');
    // 既有会话水合：插件重载/热更新会 teardown 再 apply，而既有会话不会重发
    // `agent/created`。不补这一次，那些会话的提醒永远不触发、Send now 报 no_runtime。
    runtimeRegistry.hydrate();
}
export { name };
