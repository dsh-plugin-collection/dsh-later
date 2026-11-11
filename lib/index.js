import s from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { setImageHostPathResolver } from './projection.js';
import { registerUserSchedulesProjection } from './projection-registration.js';
import { registerUserScheduleCommands } from './commands.js';
import { UserScheduleRuntime } from './runtime.js';
import { DEFAULT_MAX_PROMPT_CHARS, DEFAULT_MAX_SCHEDULES, resolvePromptLimits, userScheduleCreate, userScheduleDelete, userScheduleList, } from './user-tools.js';
import { name, SETTINGS_NAMESPACE } from './domain.js';
import { DEFAULT_SMART_WINDOW } from './smart-window.js';
import { checkKernelIdentityAtStartup } from './kernel-identity.js';
import { createRuntimeRegistry } from './runtime-registry.js';
import { createExpirySweeper, resolveScheduledAtFromLog } from './expiry-sweeper.js';
import { listOwnershipSnapshots } from './ownership-store.js';
import { isDueIndex } from './due.js';
import { readOwnEvents } from './upstream-compat.js';
import { hostDictFor } from './strings.js';
import { registerBundledSkill } from './skill.js';
function volatileIfSupported(schema) {
    const candidate = schema;
    return typeof candidate.volatile === 'function' ? candidate.volatile() : schema;
}
const configSchema = s.object({
    maxSchedules: s.number().step(1).min(1).default(DEFAULT_MAX_SCHEDULES),
    allowLongPrompts: s.boolean().default(false),
    maxPromptChars: s.number().step(1).min(1).default(DEFAULT_MAX_PROMPT_CHARS),
    showButton: s.boolean().default(true),
    showInGroupBadge: s.boolean().default(true),
    steerDelivery: s.union([s.const('followup'), s.const('steer')]).default('followup'),
    confirmDelivery: s.boolean().default(true),
    onUnconfirmed: s.union([s.const('keep'), s.const('discard')]).default('keep'),
    clockIconStyle: s.union([s.const('auto'), s.const('modern'), s.const('classic')]).default('auto'),
    bubbleMarker: s
        .union([s.const('off'), s.const('left'), s.const('meta'), s.const('hover')])
        .default('left'),
    workStart: s.string().default(DEFAULT_SMART_WINDOW.workStart),
    workEnd: s.string().default(DEFAULT_SMART_WINDOW.workEnd),
    lunchStart: s.string().default(DEFAULT_SMART_WINDOW.lunchStart),
    lunchEnd: s.string().default(DEFAULT_SMART_WINDOW.lunchEnd),
    eveningEnd: s.string().default(DEFAULT_SMART_WINDOW.eveningEnd),
    advancedSyntax: s.boolean().default(true),
});
export const Config = volatileIfSupported(configSchema);
const SchedulerSettingsSchema = Config;
export const inject = ['agents', 'sessions', 'tools', 'commands', 'settings'];
function resolveMaxSchedules(value) {
    if (typeof value !== 'number' || value < 1)
        return DEFAULT_MAX_SCHEDULES;
    return Math.floor(value);
}
const ENTRY_ID = 'later';
function resolveSchedulerPromptLimits(settings) {
    return resolvePromptLimits({
        allowLongPrompts: settings.allowLongPrompts,
        maxPromptChars: settings.maxPromptChars,
    });
}
function present(title, kind, rawInput) {
    return {
        card: 'generic',
        title,
        kind,
        ...(rawInput === undefined ? {} : { rawInput }),
    };
}
function renderText(_args, value) {
    return [{ type: 'text', text: value }];
}
export function registerUserScheduleTools(rootCtx, toolCtx, agent, getSettings, getLocale, onUserChange) {
    const disposers = [];
    const unwind = () => {
        for (const disposeOne of disposers.splice(0, disposers.length).reverse()) {
            try {
                disposeOne();
            }
            catch {
            }
        }
    };
    const registerAll = (entries) => {
        for (const entry of entries)
            disposers.push(entry());
    };
    try {
        const t = hostDictFor(getLocale());
        const armScheduler = (target) => {
            try {
                return onUserChange(target);
            }
            catch {
                return false;
            }
        };
        registerAll([
            () => toolCtx.tools.register(defineTool({
                name: 'user_schedule_create',
                description: t.toolCreateDesc,
                parameters: {
                    prompt: {
                        type: 'string',
                        required: true,
                        description: t.paramPromptDesc,
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
                        return JSON.stringify(armScheduler(agent) ? result : { ...result, warning: t.warnSchedulerNotArmed });
                    }
                    return JSON.stringify(result);
                },
                presentCall: (args) => present(t.presentCreate, 'other', args?.prompt),
            })),
            () => toolCtx.tools.register(defineTool({
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
            () => toolCtx.tools.register(defineTool({
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
                        }
                    }
                    return JSON.stringify(result);
                },
                presentCall: (args) => present(t.presentDelete, 'other', args?.id),
            })),
        ]);
        return unwind;
    }
    catch (error) {
        unwind();
        rootCtx.logger.warn(`later: user tools 注册失败: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
    }
}
const COLD_WAKE_QUIET_MS = 120_000;
function createUserWatch() {
    return {
        recent: new Map(),
        suppressed: new Map(),
    };
}
function watchSessionLifecycle(ctx, watch) {
    const note = (sessionId) => {
        if (typeof sessionId === 'string' && sessionId.length > 0)
            watch.recent.set(sessionId, Date.now());
    };
    try {
        return ctx.on('agent/disposed', ({ agent }) => note(agent?.id));
    }
    catch {
        return () => undefined;
    }
}
export function canWakeColdSession(ctx, sessionId, watch) {
    if (coldWakeRefusal(ctx, sessionId) !== undefined)
        return false;
    return !isQuiet(sessionId, watch);
}
export function coldWakeRefusal(ctx, sessionId) {
    let live;
    try {
        live = ctx.agents.get(sessionId);
    }
    catch {
        return 'not-root';
    }
    if (live === undefined)
        return undefined;
    const headerDepth = live.session?.header?.delegationDepth;
    const runtimeDepth = live.options?.subagentDepth;
    const depth = Math.max(typeof headerDepth === 'number' && Number.isFinite(headerDepth) ? headerDepth : 0, typeof runtimeDepth === 'number' && Number.isFinite(runtimeDepth) ? runtimeDepth : 0);
    if (depth > 0)
        return 'subagent';
    try {
        return ctx.agents.roots().includes(live) ? undefined : 'not-root';
    }
    catch {
        return 'not-root';
    }
}
function hasOverdueEntry(sessionId) {
    try {
        const snapshot = listOwnershipSnapshots().find((entry) => entry.sessionId === sessionId);
        if (snapshot === undefined)
            return false;
        const now = Date.now();
        return Object.values(snapshot.entries).some((entry) => isDueIndex(entry, now));
    }
    catch {
        return false;
    }
}
function isQuiet(sessionId, watch) {
    const lastTouch = watch?.recent.get(sessionId);
    return lastTouch !== undefined && Date.now() - lastTouch < COLD_WAKE_QUIET_MS;
}
const COLD_WAKE_RELEASE_POLL_MS = 50;
const COLD_WAKE_RELEASE_WAIT_MS = 30_000;
function isAgentIdle(agent) {
    return agent.status !== 'running';
}
async function releaseWokenAgent(ctx, sessionId, agent, handle, watch) {
    if (handle === undefined || typeof handle.dispose !== 'function')
        return;
    const deadline = Date.now() + COLD_WAKE_RELEASE_WAIT_MS;
    for (;;) {
        if (stopping)
            return;
        let current;
        try {
            current = ctx.agents.get(sessionId);
        }
        catch {
            return;
        }
        if (current !== agent)
            return;
        if (isAgentIdle(agent) && !hasOverdueEntry(sessionId))
            break;
        if (Date.now() >= deadline) {
            ctx.logger.warn(`later: 会话 ${sessionId} 唤醒后 ${Math.round(COLD_WAKE_RELEASE_WAIT_MS / 1000)}s 内未收敛，` +
                `本次不释放（提醒不能因为收尾而丢）；下次到期或收敛后再释放。`);
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, COLD_WAKE_RELEASE_POLL_MS));
    }
    try {
        await handle.dispose();
    }
    catch (error) {
        ctx.logger.warn(`later: 释放冷唤醒的会话句柄失败（不影响本次投递）: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    if (watch !== undefined)
        watch.recent.delete(sessionId);
}
async function wakeColdSession(ctx, sessionId, registry, watch) {
    let agent;
    let handle;
    let controller;
    try {
        controller = ctx.get('sessionController');
    }
    catch {
        controller = undefined;
    }
    if (controller !== undefined && typeof controller.resolveAgent === 'function') {
        const resolved = await controller.resolveAgent(sessionId);
        if (resolved !== undefined && resolved !== null && typeof resolved === 'object' && 'agent' in resolved) {
            const candidate = resolved;
            if (candidate.error === undefined)
                agent = candidate.agent;
        }
        else {
            agent = resolved;
        }
    }
    else {
        const agents = ctx.agents;
        if (typeof agents.resume === 'function') {
            const resumed = (await agents.resume({ resumeSessionId: sessionId }));
            if (resumed !== undefined && resumed !== null && 'agent' in resumed) {
                const owned = resumed;
                agent = owned.agent;
                handle = owned;
            }
            else {
                agent = resumed;
            }
        }
    }
    if (agent === undefined) {
        ctx.logger.warn(`later: 会话 ${sessionId} 的提醒已到期但无法叫醒（sessionController 与 agents.resume 都不可用），` +
            `本轮记为 undelivered；该会话被打开时会立即补投。`);
        return;
    }
    if (watch !== undefined) {
        watch.recent.delete(sessionId);
        watch.suppressed.delete(sessionId);
    }
    registry.mount(agent);
    const driven = registry.drive(agent);
    if (!driven) {
        ctx.logger.warn(`later: 会话 ${sessionId} 已被唤醒，但 runtime 未能驱动（root 判定未命中），` +
            `本轮按未投递处理；该会话被打开时会立即补投。`);
    }
    if (handle !== undefined) {
        const releasing = releaseWokenAgent(ctx, sessionId, agent, handle, watch);
        void releasing.catch((error) => {
            ctx.logger.warn(`later: 冷唤醒后的释放任务异常（不影响本次投递）: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
}
function hasLiveRootAgent(ctx, sessionId) {
    let live;
    try {
        live = ctx.agents.get(sessionId);
    }
    catch {
        return false;
    }
    if (live === undefined)
        return false;
    try {
        return ctx.agents.roots().includes(live);
    }
    catch {
        return false;
    }
}
let stopping = false;
export function apply(ctx, config) {
    stopping = false;
    const startMaxSchedules = resolveMaxSchedules(config?.maxSchedules);
    checkKernelIdentityAtStartup();
    setImageHostPathResolver((ref) => {
        const store = ctx.get('attachments');
        if (store === undefined)
            return undefined;
        return store.imageHostPath(ref);
    });
    ctx.inject(['sessionProjections'], (projectionCtx) => {
        projectionCtx.effect(() => registerUserSchedulesProjection(projectionCtx.sessionProjections, (m) => ctx.logger.warn(m)), 'later.userSchedulesProjection()');
    });
    const startSettings = {
        maxSchedules: startMaxSchedules,
        allowLongPrompts: false,
        maxPromptChars: DEFAULT_MAX_PROMPT_CHARS,
        steerDelivery: 'followup',
        confirmDelivery: true,
        onUnconfirmed: 'keep',
        clockIconStyle: 'auto',
        advancedSyntax: true,
    };
    let readLive = () => startSettings;
    const getSettings = () => readLive();
    ctx.inject(['settings'], (settingsCtx) => {
        const provider = settingsCtx.settings;
        const readSettings = (value) => ({
            maxSchedules: resolveMaxSchedules(value?.maxSchedules ?? startSettings.maxSchedules),
            allowLongPrompts: value?.allowLongPrompts === true,
            maxPromptChars: typeof value?.maxPromptChars === 'number' && value.maxPromptChars >= 1
                ? Math.floor(value.maxPromptChars)
                : startSettings.maxPromptChars,
            steerDelivery: value?.steerDelivery === 'steer' ? 'steer' : 'followup',
            confirmDelivery: value?.confirmDelivery !== false,
            onUnconfirmed: value?.onUnconfirmed === 'discard' ? 'discard' : 'keep',
            clockIconStyle: value?.clockIconStyle === 'modern' || value?.clockIconStyle === 'classic'
                ? value.clockIconStyle
                : 'auto',
            advancedSyntax: value?.advancedSyntax !== false,
        });
        const forms = settingsCtx.settings;
        if (typeof provider.register !== 'function' && typeof forms.describe === 'function') {
            const describeValue = () => {
                try {
                    const row = forms
                        .describe?.({ redactSecrets: true })
                        .find((candidate) => candidate.ns === ENTRY_ID);
                    return row?.value;
                }
                catch {
                    return undefined;
                }
            };
            readLive = () => readSettings(describeValue());
            settingsCtx.on('settings/document-updated', (ns) => {
                if (ns !== ENTRY_ID && ns !== SETTINGS_NAMESPACE)
                    return;
                readLive = () => readSettings(describeValue());
            });
            return;
        }
        if (typeof provider.register !== 'function')
            return;
        const scope = provider.register(SETTINGS_NAMESPACE, SchedulerSettingsSchema, { applies: 'live' });
        readLive = () => {
            try {
                return readSettings(scope.get());
            }
            catch {
                return startSettings;
            }
        };
    });
    const runtimeRegistry = createRuntimeRegistry({
        roots: () => ctx.agents.roots(),
        isStopping: () => stopping,
        create: (agent) => new UserScheduleRuntime(ctx, agent, getSettings),
        drive: (runtime) => runtime.requestDrive(),
        warn: (message) => ctx.logger.warn(message),
        attach: (agent, runtime) => {
            const disposeMount = agent.ctx.effect(() => {
                const getLocale = () => ctx.get('locale')?.getSnapshot().active;
                const disposeTools = registerUserScheduleTools(ctx, agent.ctx, agent, getSettings, getLocale, notifyUserChange);
                const stopStatus = agent.ctx.on('agent/status', ({ status }) => {
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
            return () => disposeMount();
        },
    });
    const notifyUserChange = (agent) => {
        try {
            activeSweeper?.rearm(agent.id);
        }
        catch {
        }
        try {
            return runtimeRegistry.drive(agent);
        }
        catch {
            return false;
        }
    };
    const notifyUserSteer = async (agent, id) => {
        const runtime = runtimeRegistry.ensure(agent);
        if (runtime === undefined) {
            return { ok: false, code: 'no_runtime', message: '该会话尚未挂载用户调度器。' };
        }
        try {
            activeSweeper?.reschedule();
        }
        catch {
        }
        return runtime.steerById(id);
    };
    ctx.effect(() => {
        const getLocale = () => ctx.get('locale')?.getSnapshot().active;
        return registerUserScheduleCommands(ctx, getSettings, notifyUserChange, notifyUserSteer, getLocale);
    }, 'later.commands()');
    ctx.effect(() => {
        const stopCreated = ctx.on('agent/created', async ({ agent }) => {
            runtimeRegistry.mount(agent);
        });
        return async () => {
            stopping = true;
            stopCreated();
            await runtimeRegistry.unmountAll();
        };
    }, 'later.userToolsLifecycle()');
    const userWatch = createUserWatch();
    let activeSweeper;
    ctx.effect(() => {
        const stopWatching = watchSessionLifecycle(ctx, userWatch);
        const sweeper = createExpirySweeper({
            snapshots: () => listOwnershipSnapshots((message) => ctx.logger.warn(`later: ${message}`)).filter((snapshot) => {
                return coldWakeRefusal(ctx, snapshot.sessionId) === undefined;
            }),
            wakeable: (sessionId) => coldWakeRefusal(ctx, sessionId) === undefined &&
                (!isQuiet(sessionId, userWatch) || hasOverdueEntry(sessionId)),
            refuseReason: (sessionId) => coldWakeRefusal(ctx, sessionId) === undefined &&
                isQuiet(sessionId, userWatch) &&
                !hasOverdueEntry(sessionId)
                ? 'quiet-window'
                : undefined,
            wake: (sessionId) => {
                if (hasLiveRootAgent(ctx, sessionId)) {
                    runtimeRegistry.drive(ctx.agents.get(sessionId));
                    return;
                }
                return wakeColdSession(ctx, sessionId, runtimeRegistry, userWatch);
            },
            resolveScheduledAt: (sessionId, scheduleId) => {
                const session = (() => {
                    try {
                        return ctx.sessions.get(sessionId);
                    }
                    catch {
                        return undefined;
                    }
                })();
                if (session === undefined)
                    return undefined;
                const entry = listOwnershipSnapshots().find((snapshot) => snapshot.sessionId === sessionId)?.entries[scheduleId];
                if (entry === undefined)
                    return undefined;
                return resolveScheduledAtFromLog(readOwnEvents(session), scheduleId, entry.createdAt);
            },
            warn: (message) => ctx.logger.warn(message),
        });
        activeSweeper = sweeper;
        return async () => {
            activeSweeper = undefined;
            stopWatching();
            await sweeper.dispose();
        };
    }, 'later.expirySweeper()');
    registerBundledSkill(ctx, () => ctx.get('locale')?.getSnapshot().active);
    runtimeRegistry.hydrate();
}
export { name };
