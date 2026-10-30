import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { IconInfo } from '../primitives-compat.js';
import {
  firstOrderViolation,
  isValidHhmm,
  pickSmartWindowFields,
  type SmartWindowConfig,
} from '../../smart-window.js';
import { CLOCK_SVG_CLASSIC, CLOCK_SVG_MODERN } from '../session-presence.js';

/**
 * 时钟风格预览 —— 直接复用 session-presence.ts 里线上 badge 用的**同一份** SVG
 * 字符串（单一可信源）：改 glyph 只需改一处，预览不可能与线上漂移。此前手抄一份
 * 正是尺寸/颜色对不上的根源。
 *
 * 必须包在 .ss-presence 容器里 —— styles.ts 中所有时钟样式（rect fill、track/hand
 * 的 stroke 与 stroke-width、紫色、呼吸动画）都作用域于 .ss-presence，缺了这层
 * 容器线上样式一条都不会命中。SVG 为插件自带常量，dangerouslySetInnerHTML 可信。
 */
function ClockIconPreview({ style }: { style: string }): JSX.Element {
  const svg = style === 'classic' ? CLOCK_SVG_CLASSIC : CLOCK_SVG_MODERN;
  return <span className="ss-presence" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * 宿主 settingsScope 服务的最小结构视图（client 侧契约，仅列出本组件用到的成员）。
 * 不从 @deepseek-ai/dsh-client-runtime/client 导入：该包是 0.1.1 内核特有，0.1.2 已
 * 拆走；且同名 SettingsScope 在 host（dsh-settings）与 client 两侧成员并不同。
 */
interface ScopeSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable';
  value: T | undefined;
  base: unknown;
  user: unknown;
  writable: boolean;
}

interface SettingsScope<T> {
  getSnapshot(): ScopeSnapshot<T>;
  subscribe(listener: () => void): () => void;
  set(field: string, value: unknown): Promise<void>;
  unset(field: string): Promise<void>;
}

/** 设置面存储形态（与 SchedulerSettingsSchema 一致，缺省字段表示回退默认）。 */
export interface SchedulerSettings {
  showButton?: boolean;
  /**
   * 是否在 dsh-group-status 的折叠分组徽标里显示「定时任务」这一格（issue #83）。
   * 关闭的实现是**不登记 facet**——对端 #37 废弃 `settingKey` 后，那是唯一的显隐机制。
   */
  showInGroupBadge?: boolean;
  maxSchedules?: number;
  workStart?: string;
  workEnd?: string;
  lunchStart?: string;
  lunchEnd?: string;
  eveningEnd?: string;
  steerDelivery?: 'followup' | 'steer';
  confirmDelivery?: boolean;
  onUnconfirmed?: 'keep' | 'discard';
  clockIconStyle?: 'auto' | 'modern' | 'classic';
  /** 定时消息气泡标记档位（issue #112）。 */
  bubbleMarker?: 'off' | 'left' | 'meta' | 'hover';
  /** 高级语法（Beta）：多次写法开关，默认开。 */
  advancedSyntax?: boolean;
  /** 是否解除提示字符的默认上限（1000）。**默认关**，开启后 maxPromptChars 才生效。 */
  allowLongPrompts?: boolean;
  /** 提示字符上限（≥1 整数）；仅在 allowLongPrompts=true 时生效。 */
  maxPromptChars?: number;
}

/** 字段元数据（顺序固定，便于稳定渲染）。 */
type FieldDef =
  | {
      readonly kind: 'boolean';
      readonly key: 'showButton' | 'showInGroupBadge' | 'confirmDelivery' | 'advancedSyntax' | 'allowLongPrompts';
      readonly labelKey: string;
      readonly hintKey?: string;
      readonly defaultValue: boolean;
    }
  | {
      readonly kind: 'number';
      readonly key: 'maxSchedules' | 'maxPromptChars';
      readonly labelKey: string;
      readonly hintKey: string;
      readonly defaultValue: number;
      /**
       * 依赖另一个布尔开关：该开关为关时本字段**禁用并灰显**（§6.3 联动）。
       * 仅影响渲染与禁用态，不改数值——开启开关不会自动改动本字段。
       */
      readonly requiresEnabled?: 'allowLongPrompts';
    }
  | { readonly kind: 'time'; readonly key: 'workStart' | 'workEnd' | 'lunchStart' | 'lunchEnd' | 'eveningEnd'; readonly labelKey: string; readonly hintKey?: string }
  | { readonly kind: 'enum'; readonly key: 'steerDelivery' | 'onUnconfirmed' | 'clockIconStyle' | 'bubbleMarker'; readonly labelKey: string; readonly hintKey?: string; readonly options: readonly string[]; readonly defaultValue: string };

/** Section 分组（对齐官方插件设置页的 section 结构）。 */
interface SectionDef {
  readonly id: string;
  readonly titleKey: string;
  /** 该 section 里的能力处于 Beta：标题旁挂 Beta 徽标。 */
  readonly beta?: boolean;
  /** 字段布局：grid 两列并排（对齐官方 hF0LTq_limits），stack 单列堆叠。 */
  readonly layout: 'grid' | 'stack';
  readonly fields: readonly FieldDef[];
}

const SECTIONS: readonly SectionDef[] = [
  {
    id: 'display',
    titleKey: 'sectionDisplay',
    layout: 'stack',
    fields: [
      {
        kind: 'boolean',
        key: 'showButton',
        labelKey: 'showButtonLabel',
        hintKey: 'showButtonHint',
        defaultValue: true,
      },
      {
        // 与 showButton 同为「纯显隐」：关掉只是不再向 dsh-group-status 登记 facet，
        // 提醒本身照触发。默认开（与 host Config 同源），且**只有显式 false 才关**。
        kind: 'boolean',
        key: 'showInGroupBadge',
        labelKey: 'showInGroupBadgeLabel',
        hintKey: 'showInGroupBadgeHint',
        defaultValue: true,
      },
      {
        kind: 'enum',
        key: 'clockIconStyle',
        labelKey: 'clockIconStyleLabel',
        hintKey: 'clockIconStyleHint',
        options: ['auto', 'modern', 'classic'],
        defaultValue: 'auto',
      },
      {
        kind: 'enum',
        key: 'bubbleMarker',
        labelKey: 'bubbleMarkerLabel',
        hintKey: 'bubbleMarkerHint',
        options: ['left', 'meta', 'hover', 'off'],
        defaultValue: 'left',
      },
      { kind: 'number', key: 'maxSchedules', labelKey: 'maxSchedulesLabel', hintKey: 'maxSchedulesHint', defaultValue: 100 },
      {
        kind: 'boolean',
        key: 'allowLongPrompts',
        labelKey: 'allowLongPromptsLabel',
        hintKey: 'allowLongPromptsHint',
        // 与 host schema 的 default(false) 一致：默认**关**，上限恒为 1000。
        defaultValue: false,
      },
      {
        kind: 'number',
        key: 'maxPromptChars',
        labelKey: 'maxPromptCharsLabel',
        hintKey: 'maxPromptCharsHint',
        // 与 host schema 的 DEFAULT_MAX_PROMPT_CHARS 一致。
        defaultValue: 1000,
        requiresEnabled: 'allowLongPrompts',
      },
    ],
  },
  {
    id: 'time',
    titleKey: 'sectionTime',
    layout: 'grid',
    fields: [
      { kind: 'time', key: 'workStart', labelKey: 'workStartLabel', hintKey: 'smartWindowHint' },
      { kind: 'time', key: 'workEnd', labelKey: 'workEndLabel' },
      { kind: 'time', key: 'lunchStart', labelKey: 'lunchStartLabel' },
      { kind: 'time', key: 'lunchEnd', labelKey: 'lunchEndLabel' },
      { kind: 'time', key: 'eveningEnd', labelKey: 'eveningEndLabel' },
    ],
  },
  {
    id: 'delivery',
    titleKey: 'sectionDelivery',
    layout: 'stack',
    fields: [
      {
        kind: 'enum',
        key: 'steerDelivery',
        labelKey: 'steerDeliveryLabel',
        hintKey: 'steerDeliveryHint',
        options: ['followup', 'steer'],
        defaultValue: 'followup',
      },
      {
        kind: 'boolean',
        key: 'confirmDelivery',
        labelKey: 'confirmDeliveryLabel',
        hintKey: 'confirmDeliveryHint',
        defaultValue: true,
      },
      {
        kind: 'enum',
        key: 'onUnconfirmed',
        labelKey: 'onUnconfirmedLabel',
        hintKey: 'onUnconfirmedHint',
        options: ['keep', 'discard'],
        defaultValue: 'keep',
      },
    ],
  },
  {
    id: 'advanced',
    titleKey: 'sectionAdvanced',
    layout: 'stack',
    beta: true,
    fields: [
      {
        kind: 'boolean',
        key: 'advancedSyntax',
        labelKey: 'advancedSyntaxLabel',
        hintKey: 'advancedSyntaxHint',
        defaultValue: true,
      },
    ],
  },
] as const;

const FIELDS: readonly FieldDef[] = SECTIONS.flatMap((s) => s.fields);

/**
 * 卡片渲染出来的**全部** `kind: 'time'` 字段 key（从 SECTIONS 现取，不在这里再抄一份名单）。
 *
 * 为什么不写死五个：跨字段的序关系校验要把这五格的当前值凑起来（见
 * `windowDraft`）。写死名单的话，将来给 `time` 段加第六格（或把某格挪走）时校验会
 * 静默少查一项——正是本次要修的「卡片能写、下游不认」那类漂移的镜像版本。
 * 「名单必须与 `SMART_WINDOW_ORDER` 覆盖的字段集合相等」由
 * `tests/settings-schema-coverage.test.mjs` 钉住。
 */
const TIME_KEYS = FIELDS.flatMap((field) => (field.kind === 'time' ? [field.key] : []));

/**
 * 段尾那句「顺序不成立」说明的 DOM id。
 *
 * 命名带连字符是刻意的：卡片里**字段控件**的 id 恒为 `ss-<字段 key>`（字段 key 全是驼峰），
 * 非字段的元素（`ss-help-*` / `ss-gate-*` / 详情页那个 `ss-show-settings`）一律带连字符。
 * 门禁（`tests/settings-schema-coverage.test.mjs`）取「可写字段集合」时按「是字段控件
 * （input / select / button[role=switch]）**且** id 形如 `ss-<驼峰>`」两条一起判，所以这个
 * id 就算改成驼峰也不会被误认成一项设置（变异实测：改名的后果是让「按 id 找得到段尾说明」
 * 那条断言变红，字段集合那条照旧绿）。带连字符真正的价值是：一眼看上去就是「一段说明」，
 * 而不是「又一格设置」。
 */
const ORDER_MESSAGE_ID = 'ss-window-order';

/** 单字段的 pending 编辑意图：`{value, reset:true}` 表示点击 reset 等待保存。 */
type Pending = { readonly value: string; readonly reset: boolean };
type PendingMap = Partial<Record<string, Pending>>;

export interface SchedulerSettingsCardProps {
  scope: SettingsScope<SchedulerSettings>;
  t: (key: string) => string;
  /** 渲染面：`detail` = 插件详情页（显示「在设置中显示」开关）；`settings` = 设置对话框页。 */
  surface?: 'detail' | 'settings';
}

/**
 * 定时提醒插件设置卡片（设置 → 插件 → 插件配置）。
 *
 * 视觉与交互对齐官方 PluginCard（dsh-client-ui-settings-plugins 内部私有组件，
 * bundle 纯净性门控禁止 import 其卡片 chrome/表单模型作为值，这里按相同结构
 * 自实现，参考 dsh-wakatime 同款做法）：
 *  - header 整卡按钮默认收起，点击展开/收起（折叠态只显示标题+描述）；
 *  - 有未保存草稿时 header 显示「未保存」徽章（折叠态也能看见）；
 *  - 字段为「label 行（覆盖徽章 + 重置）→ 输入控件 → 提示」三段式；
 *  - 非法草稿阻塞保存；保存后清空草稿；写入失败保留草稿并报错。
 *
 * 分成「外壳 + 表单主体」两层，唯一理由是 **hooks 必须在每次渲染里同序同数**。
 * 旧实现把 `handleDiscard` / `handleSave` 两个 `useCallback` 写在
 * `if (snapshot.status === 'unavailable') return <></>` **之后**：早退的那一帧只用 8 个
 * 槽位，渲染出表单的那一帧用 10 个。只要快照在两帧之间从非 ready 推进到 ready——首帧读到
 * `loading`、随后由订阅补上 `ready` 就是这条路径——React 就抛
 * 「Rendered more hooks than during the previous render」。现在外壳只保留**所有早退之前**
 * 的那几个 hook，表单状态整体搬进 {@link SchedulerSettingsForm}：内层自己没有任何
 * 早退，它的 hook 集合与外壳走哪条分支再无关系，违规从结构上消失。
 *
 * 顺带记一笔（本提交**不动**）：卡片里的 `id` 全是静态串（`ss-show-settings`、
 * `ss-section-${id}`、`ss-help-${key}`、`ss-gate-${key}`），不是 `useId()`。详情页与控制面
 * 同时挂载时同名 id 会撞车，`htmlFor` / `aria-controls` 指到别的节点上。改它必然改 DOM，
 * 需要 GUI 复核，留给单独的议题。
 */
export function SchedulerSettingsCard({ scope, t, surface }: SchedulerSettingsCardProps): JSX.Element {
  // 快照与「写入失败」标记归外壳，因为二者都由**订阅回调**驱动，而订阅在 `unavailable`
  // （渲染空 fragment、根本没有子组件可挂）期间也必须继续挂着：命名空间后来变 ready 时，
  // 卡片靠这条订阅补出来。`failed` 同属这条回调，留在它被清零的地方，语义与拆分前逐字相同。
  const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const initial = scope.getSnapshot();
    setSnapshot(initial);
    // 原本这里还有 `setPending({})`：pending 已随表单搬进内层，由内层自己的 scope effect 清。
    if (initial.status === 'ready') setFailed(false);
  }, [scope]);

  useEffect(() => {
    return scope.subscribe(() => {
      const snap = scope.getSnapshot();
      setSnapshot(snap);
      if (snap.status === 'ready') {
        setFailed(false);
      }
    });
  }, [scope]);

  if (snapshot.status === 'unavailable') return <></>; // 命名空间未暴露时不显示卡片
  if (snapshot.status !== 'ready') {
    if (snapshot.status === 'loading') return <div className="ss-hint">{t('loading')}</div>;
    return <div className="ss-hint">{t('unavailable')}</div>;
  }
  // 三条早退全部排在上面 4 个 hook 之后，且这里不再有 hook —— 外壳每次渲染恒用同样 4 个槽位。
  return (
    <SchedulerSettingsForm
      scope={scope}
      t={t}
      surface={surface}
      snapshot={snapshot}
      failed={failed}
      setFailed={setFailed}
    />
  );
}

/** {@link SchedulerSettingsForm} 的入参：外壳读到的快照 + 仍留在外壳的失败标记。 */
interface SchedulerSettingsFormProps extends SchedulerSettingsCardProps {
  snapshot: ScopeSnapshot<SchedulerSettings>;
  /** 写入失败标记。由外壳持有（订阅回调负责清零），内层只读写它。 */
  failed: boolean;
  setFailed: (next: boolean) => void;
}

/**
 * 设置卡主体，仅在外层读到 `status === 'ready'` 时挂载。
 *
 * 状态模型：每个字段维护独立的 `pending` 中间态（待保存的 value + reset 意图）；
 * 保存时按字段批量写。`reset` 表示「点击了 reset 按钮但尚未保存」，实际写入
 * 由 save 统一调用 `unset` 完成。空串视为「回退默认」→ unset。
 *
 * 本组件内部**没有早退**：所有 hook 都在渲染主体前依次跑完，这正是拆分要换来的性质。
 *
 * 拆分唯一改变的东西是本组件的**挂载生命周期**：快照若从 ready 退回非 ready 再回到 ready，
 * 这里会整体重挂载一次，`helpOpen` / `showSettings` 这类纯展示态随之归零（`pending` 原本
 * 也会被清）。拆分前这个归零点观察不到：回到 ready 的那一帧要索取第 9、10 个槽位，而上一帧
 * 只用了 8 个，React 在渲染主体跑到表单之前就先抛了
 * 「Rendered more hooks than during the previous render」。
 */
function SchedulerSettingsForm({ scope, t, surface, snapshot, failed, setFailed }: SchedulerSettingsFormProps): JSX.Element {
  const [pending, setPending] = useState<PendingMap>({});
  const [saving, setSaving] = useState(false);
  /** 帮助按钮展开态（对齐官方 _helpButton_：aria-expanded 切换） */
  const [helpOpen, setHelpOpen] = useState<Readonly<Record<string, boolean>>>({});

  // 「在设置中显示」开关：仅详情页显示，控制 settings.plugin.item 是否注册。
  // localStorage 非响应式，切换后需刷新页面生效。
  const SHOW_SETTINGS_KEY = 'dsh-later:show-settings-section';
  const [showSettings, setShowSettings] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(SHOW_SETTINGS_KEY) === 'true';
  });
  const toggleShowSettings = (): void => {
    const next = !showSettings;
    setShowSettings(next);
    if (typeof localStorage !== 'undefined') {
      if (next) localStorage.setItem(SHOW_SETTINGS_KEY, 'true');
      else localStorage.removeItem(SHOW_SETTINGS_KEY);
    }
  };

  /**
   * `scope` 换成另一个对象 → 草稿作废（这条原先和 `setSnapshot` 一起放在外壳的 scope
   * 同步 effect 里）。两处的可见结果等价：外壳只在 ready 时才挂载本组件，所以「快照变成
   * 非 ready」时本组件整体卸载，重新挂载时 `pending` 本来就是空的。
   */
  useEffect(() => {
    setPending({});
  }, [scope]);

  // Partial<SchedulerSettings> 兜底：`?? {}` 让 TS 能以显式类型 narrow 出字段；
  // 索引访问通过 type guard 处理 undefined；运行时仍按 `value[key] ?? default`。
  const value: Partial<SchedulerSettings> = snapshot.value ?? {};
  const base: Partial<SchedulerSettings> = (snapshot.base as Partial<SchedulerSettings> | undefined) ?? {};
  const user = snapshot.user;
  const writable = snapshot.writable === true;

  /** 该字段用户层是否覆盖。 */
  const isUserOverridden = (key: string): boolean =>
    user !== undefined &&
    typeof user === 'object' &&
    Object.prototype.hasOwnProperty.call(user as object, key);

  /** 该字段当前展示文本：pending 优先于已保存。 */
  const displayValue = (field: FieldDef): string => {
    const p = pending[field.key];
    if (p !== undefined) return p.value;
    if (field.kind === 'number') {
      const v = value[field.key];
      return v === undefined ? '' : String(v);
    }
    if (field.kind === 'boolean') {
      const v = value[field.key];
      // 缺省（未设置）按**该字段声明的默认值**判定，不能写死 true：
      // showButton/confirmDelivery/advancedSyntax 恰好都默认开，旧实现
      // `v === false ? 'false' : 'true'` 对它们碰巧正确；而 allowLongPrompts
      // 默认**关**，写死 true 会让开关显示「开」、宿主按「关」处理——
      // 用户看到 maxPromptChars 已启用却仍被 1000 字符拒绝。
      return (v ?? field.defaultValue) ? 'true' : 'false';
    }
    if (field.kind === 'enum') {
      const v = value[field.key];
      return typeof v === 'string' ? v : field.defaultValue;
    }
    const v = value[field.key];
    return v ?? '';
  };

  /** 该字段 baseline（reset 后的值，即 base 或默认）。 */
  const baselineValue = (field: FieldDef): string => {
    if (field.kind === 'number') {
      const v = base[field.key];
      return String(v ?? field.defaultValue);
    }
    if (field.kind === 'boolean') {
      const v = base[field.key];
      // 同 displayValue：按字段声明的默认值判定，不写死 true。
      return (v ?? field.defaultValue) ? 'true' : 'false';
    }
    if (field.kind === 'enum') {
      const v = base[field.key];
      return typeof v === 'string' ? v : field.defaultValue;
    }
    const v = base[field.key];
    return v ?? '';
  };

  const dirty = Object.keys(pending).length > 0 && Object.values(pending).some((p) => p !== undefined);

  const validate = (field: FieldDef, raw: string): string | null => {
    if (field.kind === 'number') {
      if (raw.trim().length === 0) return t('invalidLabel');
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 1 || !Number.isInteger(num)) return t('invalidLabel');
      return null;
    }
    if (field.kind === 'boolean') return null; // 取值恒为 'true'/'false'，无需校验
    if (field.kind === 'enum') return field.options.includes(raw) ? null : t('invalidLabel');
    if (raw.trim().length === 0) return null; // 空 = unset
    if (!isValidHhmm(raw)) return t('invalidTimeLabel');
    return null;
  };

  const setFieldPending = (key: string, value: string, reset: boolean): void => {
    setPending((current) => ({ ...current, [key]: { value, reset } }));
  };

  const handleFieldEdit = (field: FieldDef, raw: string): void => {
    setFieldPending(field.key, raw, false);
    setFailed(false);
  };

  const handleResetField = (field: FieldDef): void => {
    setFieldPending(field.key, baselineValue(field), true);
    setFailed(false);
  };

  const handleDiscard = useCallback(() => {
    setPending({});
    setFailed(false);
  }, []);

  /** 读某字段的生效值（pending 优先于已保存），复用字段自身的渲染口径。 */
  const effectiveOf = (key: string): string => {
    const field = FIELDS.find((entry) => entry.key === key);
    return field === undefined ? '' : displayValue(field);
  };

  /**
   * 「投递确认」当前是否开启（pending 优先于已保存）—— 决定 steer 风险文案的口径。
   * 默认 true（与 schema 一致：未设置即为开）。
   */
  const confirmEnabled = effectiveOf('confirmDelivery') !== 'false';

  /**
   * 「允许长文本」是否开启（pending 优先）—— 决定 maxPromptChars 的可编辑态（§6.3）。
   * 默认 false：与 host schema 的 default(false) 同源，关闭时上限恒为 1000。
   *
   * ⚠️ 声明位置有硬性要求：必须在 handleSave / invalidField 之前。`const` 处于 TDZ，
   * 若把它们放在后面而在 `handleSave` 的依赖数组里引用，组件**渲染时**就会
   * ReferenceError（不是调用时才炸），整张设置卡白屏。
   */
  const allowLongEnabled = effectiveOf('allowLongPrompts') === 'true';

  /** 该字段是否因联动锁而不可编辑（§6.3）。 */
  const isGateLocked = (field: FieldDef): boolean =>
    'requiresEnabled' in field && field.requiresEnabled === 'allowLongPrompts' && !allowLongEnabled;

  /**
   * 五个时段格「草稿优先」凑成的候选配置。
   *
   * 用 `pickSmartWindowFields`（只按格式逐项回落）而不是
   * `sanitizeSmartWindowConfig`（序关系不成立时**整体**回落默认）：卡片要把红框挂到
   * 被写反的那两格上，而整体回落会先把用户真正填的组合盖掉，红框就没有归属了。
   * 空串 = 未填 = 回落默认，与保存时「空串走 unset」的口径一致。
   */
  const windowDraft = (): SmartWindowConfig => {
    const raw: Partial<Record<keyof SmartWindowConfig, string>> = {};
    for (const key of TIME_KEYS) {
      const text = effectiveOf(key);
      if (text.trim().length > 0) raw[key as keyof SmartWindowConfig] = text;
    }
    return pickSmartWindowFields(raw);
  };

  /**
   * 序关系被破坏的那一对相邻边界（全部满足则 null）。
   * 规则表 `SMART_WINDOW_ORDER` 定义在 smart-window.ts，与消费端的 `isValidWindow`
   * 同一份 —— 所以「卡片拒绝保存的组合」与「面板整体降级的组合」必然是同一个集合，
   * 不会出现「卡片放行了、下游算出别的东西」。
   */
  const orderViolation = firstOrderViolation(windowDraft());

  /**
   * 是否因序关系**禁止保存**。
   *
   * 只在用户的草稿参与了这个组合时才拦——理由与 §6.3 的联动锁同一条：同一个脏值也可能
   * 来自 profile yml 或别的代次写入的已保存值，那种情况下把整张卡的保存按钮锁死，用户
   * 连「显示定时按钮」都改不动，只会以为卡片坏了。不锁的时候红框与说明照旧指出问题在哪
   * 两格，用户改任一格到合法顺序即可。
   */
  const orderBlocked =
    orderViolation !== null && TIME_KEYS.some((key) => pending[key] !== undefined);

  /** 该字段是否属于被写反的那一对（仅时段格）。 */
  const isOrderFlagged = (field: FieldDef): boolean =>
    orderViolation !== null &&
    (orderViolation[0] === field.key || orderViolation[1] === field.key);

  const handleSave = useCallback(async () => {
    if (!dirty || saving || !writable || orderBlocked) return;
    setSaving(true);
    setFailed(false);
    try {
      for (const [key, p] of Object.entries(pending)) {
        if (p === undefined) continue;
        if (p.reset) {
          await scope.unset(key as keyof SchedulerSettings);
          continue;
        }
        // 空串视为「回退默认」，unset 比 set 空值更直观。
        if (p.value.trim().length === 0) {
          await scope.unset(key as keyof SchedulerSettings);
          continue;
        }
        const field = FIELDS.find((entry) => entry.key === key);
        // 联动锁住的字段：非法草稿**不写**。invalidField 对锁住字段返回 null
        // （不锁死保存按钮），所以这里必须自己拦一道，否则「开长文本→填非法值→
        // 关长文本→保存」会把脏值落进配置。合法值照写：宿主在关闭态本就不读它，
        // 保留用户填的数也符合「切换开关不自动改数值」（§6.3）。
        if (field !== undefined && isGateLocked(field) && validate(field, p.value) !== null) continue;
        const coerced =
          field?.kind === 'number'
            ? Number(p.value)
            : field?.kind === 'boolean'
              ? p.value === 'true'
              : p.value;        await scope.set(key as keyof SchedulerSettings, coerced as never);
      }
      setPending({});
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }, [scope, pending, dirty, saving, writable, allowLongEnabled, orderBlocked]);

  // 校验所有 pending 字段（已弃 dirty 字段忽略）。
  const invalidField = (field: FieldDef): string | null => {
    // 联动禁用的字段不参与校验：§6.3 要求「切换开关不自动改数值」，所以
    // 用户可能先开了长文本、填了非法值、又关掉——此时该字段既不可编辑，
    // 也不该把整张卡的保存按钮锁死（那会让用户以为关不掉长文本）。
    if (isGateLocked(field)) return null;
    const p = pending[field.key];
    if (p === undefined) return null;
    return validate(field, p.value);
  };
  const anyInvalid = FIELDS.some((field) => invalidField(field) !== null);
  const saveDisabled = !dirty || saving || !writable || anyInvalid || orderBlocked;

  return (
    <div className="ss-settings-form">
      {!writable && (
        <p className="ss-hint" role="status">
          {t('readOnly')}
        </p>
      )}

      {/* 仅详情页显示：控制设置对话框中是否出现本插件的设置页。
          localStorage 非响应式，切换后需刷新页面生效。 */}
      {surface === 'detail' && (
        <section className="ss-section" aria-labelledby="ss-section-display-toggle">
          <h3 className="ss-section-heading" id="ss-section-display-toggle">{t('sectionDisplayToggle')}</h3>
          <div className="ss-section-fields">
            <div className="ss-field">
              <div className="ss-toggle-row">
                <div className="ss-label-group">
                  <label className="ss-toggle-label" htmlFor="ss-show-settings">{t('showInSettings')}</label>
                </div>
                <button
                  type="button"
                  id="ss-show-settings"
                  role="switch"
                  aria-checked={showSettings}
                  aria-label={t('showInSettings')}
                  className="ss-toggle-switch"
                  onClick={toggleShowSettings}
                />
              </div>
              <p className="ss-toggle-description">{t('showInSettingsHint')}</p>
            </div>
          </div>
        </section>
      )}

      {SECTIONS.map((section) => (
        <section className="ss-section" key={section.id} aria-labelledby={`ss-section-${section.id}`}>
          <h3 className="ss-section-heading" id={`ss-section-${section.id}`}>
            {t(section.titleKey)}
            {section.beta === true ? (
              <span className="ss-section-beta" aria-label={t('betaBadgeAria')}>
                {t('betaBadge')}
              </span>
            ) : null}
          </h3>
          <div className={section.layout === 'grid' ? 'ss-section-fields ss-section-fieldsGrid' : 'ss-section-fields'}>
            {section.fields.map((field) => {
              const invalid = invalidField(field);
              const isTime = field.kind === 'time';
              /** 被写反的那一对：红框挂在这两格上，解释文字在段尾统一给一次。 */
              const orderFlagged = isOrderFlagged(field);
              const labelKey = field.labelKey;
              const hintKey = field.hintKey;
              const userHas = isUserOverridden(field.key);
              const fieldId = `ss-${field.key}`;
              // 该字段的 label 末尾是否内联一个图标预览（目前仅时钟图标风格）。
              const hasLabelIcon = field.key === 'clockIconStyle';
              const helpHint = hintKey !== undefined && t(hintKey).length > 0;
              /**
               * 联动锁：字段声明了 `requiresEnabled` 且那个开关当前为关 → 本字段
               * 禁用并灰显（§6.3）。数值**不改**——开关打开后仍是原值。
               */
              const gateLocked = isGateLocked(field);
              const badges = userHas ? (
                <span className="ss-card-badges">
                  <span className="ss-card-badge">{t('overriddenLabel')}</span>
                  <button
                    type="button"
                    className="ss-card-reset"
                    disabled={!writable || saving}
                    onClick={() => handleResetField(field)}
                  >
                    {t('resetLabel')}
                  </button>
                </span>
              ) : null;
              /* 布尔字段用官方 toggle 行（label 左 + switch 右，说明常驻）；
                 其余字段保持「label 行 → 输入 → 帮助展开」三段式。 */
              if (field.kind === 'boolean') {
                const checked = displayValue(field) !== 'false';
                return (
                  <div className="ss-field" key={field.key}>
                    <div className="ss-toggle-row">
                      <div className="ss-label-group">
                        <label htmlFor={fieldId} className="ss-toggle-label">
                          {t(labelKey)}
                        </label>
                      </div>
                      {badges}
                      <button
                        type="button"
                        id={fieldId}
                        role="switch"
                        aria-checked={checked}
                        aria-label={t(labelKey)}
                        className="ss-toggle-switch"
                        disabled={!writable || saving}
                        onClick={() => handleFieldEdit(field, checked ? 'false' : 'true')}
                      />
                    </div>
                    {helpHint ? <p className="ss-toggle-description">{t(hintKey)}</p> : null}
                    {invalid !== null ? <p className="ss-card-invalid" role="status">{invalid}</p> : null}
                  </div>
                );
              }
              return (
                <div className="ss-field" key={field.key}>
                  <div className="ss-card-fieldHead">
                    <div className="ss-label-group">
                      <label htmlFor={fieldId} className={hasLabelIcon ? 'ss-card-label ss-card-label--withIcon' : 'ss-card-label'}>
                        {t(labelKey)}
                        {hasLabelIcon && (
                          <ClockIconPreview style={displayValue(field)} />
                        )}
                      </label>
                      {helpHint && (
                        <button
                          type="button"
                          className={helpOpen[field.key] === true ? 'ss-help-btn ss-help-btnOpen' : 'ss-help-btn'}
                          aria-label={`${t(labelKey)}说明`}
                          aria-expanded={helpOpen[field.key] === true}
                          aria-controls={`ss-help-${field.key}`}
                          onClick={() => setHelpOpen((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}
                        >
                          <IconInfo size={12} />
                        </button>
                      )}
                    </div>
                    {badges}
                  </div>
                  {field.kind === 'enum' ? (
                    <select
                      id={fieldId}
                      className={invalid !== null ? 'ss-input ss-inputInvalid' : 'ss-input'}
                      aria-invalid={invalid !== null || undefined}
                      value={displayValue(field)}
                      disabled={!writable || saving}
                      onChange={(event) => handleFieldEdit(field, event.target.value)}
                    >
                      {field.options.map((option) => (
                        <option value={option} key={option}>
                          {t(`${field.key}Option_${option}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={fieldId}
                      type={isTime ? 'time' : 'text'}
                      inputMode={isTime ? undefined : 'numeric'}
                      className={invalid !== null || orderFlagged ? 'ss-input ss-inputInvalid' : 'ss-input'}
                      aria-invalid={invalid !== null || orderFlagged || undefined}
                      value={displayValue(field)}
                      placeholder={field.kind === 'number' ? String(field.defaultValue) : undefined}
                      disabled={!writable || saving || gateLocked}
                      aria-describedby={gateLocked ? `ss-gate-${field.key}` : orderFlagged ? ORDER_MESSAGE_ID : undefined}
                      onChange={(event) => handleFieldEdit(field, event.target.value)}
                    />
                  )}
                  {/* §6.3 联动：依赖开关处于关闭态时，就地说明为何不可编辑。 */}
                  {gateLocked ? (
                    <p className="ss-card-gate" id={`ss-gate-${field.key}`} role="status">
                      {t('maxPromptCharsLockedHint')}
                    </p>
                  ) : null}
                  {invalid !== null ? (
                    <p className="ss-card-invalid" role="status">{invalid}</p>
                  ) : null}
                  {helpOpen[field.key] === true && hintKey !== undefined && t(hintKey).length > 0 ? (
                    <div id={`ss-help-${field.key}`} role="region" aria-label={`${t(labelKey)}说明`} className="ss-help">
                      <p>{t(hintKey)}</p>
                    </div>
                  ) : null}
                  {field.key === 'steerDelivery' && displayValue(field) === 'steer' ? (
                    <p className="ss-card-risk" role="status">
                      {confirmEnabled ? t('steerRiskGuarded') : t('steerRiskUnguarded')}
                    </p>
                  ) : null}
                  {field.key === 'onUnconfirmed' && displayValue(field) === 'discard' ? (
                    <p className="ss-card-risk" role="status">
                      {t('discardRisk')}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {/*
            段级跨字段校验（issue #19）：五格的**组合**必须满足 SMART_WINDOW_ORDER 的序关系。
            规则表与消费端 `isValidWindow` 同一份，所以卡片拦住不保存的组合，与消费端
            整体回落默认的组合，是同一个集合——不存在「卡片放行了、面板算出另一套时段」。
            说明只在段尾给一次（而不是在五格各挂一句），被写反的那两格由红框承担定位。
          */}
          {section.fields.some((field) => field.kind === 'time') && orderViolation !== null ? (
            <p className="ss-card-invalid" id={ORDER_MESSAGE_ID} role="status">
              {t('smartWindowOrderHint')}
            </p>
          ) : null}
        </section>
      ))}

      <div className="ss-card-footer">
        {failed && (
          <p className="ss-card-failed" role="status">
            {t('saveFailed')}
          </p>
        )}
        {dirty && (
          <button
            type="button"
            className="ss-card-discard"
            disabled={saving}
            onClick={handleDiscard}
          >
            {t('discard')}
          </button>
        )}
        <button
          type="button"
          className="ss-card-save"
          disabled={saveDisabled}
          onClick={() => void handleSave()}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}
