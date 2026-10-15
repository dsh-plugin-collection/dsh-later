/**
 * 跟随宿主 DSH 语言设置的文案 hook 与取值器。
 *
 * 宿主的 `@deepseek-ai/dsh-client-locale` 在 client context 上暴露 `locale`
 * 服务（getSnapshot/subscribe，LocaleFace 形状）；本 hook 以
 * `useSyncExternalStore` 订阅其 active locale，语言切换时触发重渲染。
 * locale 服务缺失（旧宿主组合）时回退中文，行为与 v1 一致。
 *
 * 两条取词路径并存（issue #28），按组件形状选用，别混用：
 *  - `SchedT.tr`（由 {@link schedTranslate} 构造）：**函数式**，seat 优先。
 *    dock 用它——宿主插槽 `locale: NS` 给的 `t` 是首选来源。
 *  - `SchedT.t`：**object 形状**，纯本地字典。仍按 `t.foo` 取词的组件
 *    （SchedButton / SchedPanel / TaskList）走它，形状不可改（那些文件不在
 *    本次改动范围内）。
 * @module dsh-later/client/useSchedT
 */
import { useCallback, useSyncExternalStore } from 'react';
import { dictFor, format, type SchedLocaleId, type SchedStrings, type SchedUIKey } from './strings.js';

/** 宿主 locale 服务的结构化子集（避免引入运行时包类型依赖）。 */
export interface LocaleFaceLike {
  /** 当前不可变快照（变更前引用稳定）。 */
  getSnapshot(): { active: string; revision: number };
  /** 订阅快照变化；返回退订函数。 */
  subscribe(fn: () => void): () => void;
}

/**
 * 宿主插槽 locale seat 给的取值函数（`TranslateNS<NS>` 的运行时形状）。
 *
 * 由 dsh-client-ui-renderer 在装配标准件时挂上：条目声明了 `locale: NS` 才会收到
 * `t`；它按宿主 active locale 查表，并自己做 `{name}` 插值。
 */
export type SeatTranslate = (key: string, params?: Record<string, unknown>) => string;

/**
 * 组件侧使用的受限取值函数：key 被本地字典的键集卡住。
 *
 * 这条约束是本次迁移的主要防错手段——把 `t.foo` 机械改成 `t('foo')` 时，
 * 任何拼错的 key 会在 typecheck 直接失败，而不是静默把 key 名渲染到界面上。
 */
export type SchedTranslate = (key: SchedUIKey, params?: Record<string, string | number>) => string;

const noopSubscribe = (): (() => void) => () => {};

export interface SchedT {
  /** 当前文案字典（object 形状的老路径，供仍按 `t.foo` 取词的组件使用）。 */
  t: SchedStrings;
  /** 当前语言 id（时间格式化等需要区分语言时使用）。 */
  lang: SchedLocaleId;
  /**
   * seat 优先的函数式取词（issue #28）：宿主插槽 `t` 可用就用它，否则整体回落
   * 上面那份本地字典。dock 走这条路。
   */
  tr: SchedTranslate;
}

/**
 * 返回当前语言的文案字典、语言 id，以及 seat 优先的函数式取词器。
 *
 * 宿主语言切换时组件自动重渲染：走 `seatT` 时由宿主在装配标准件时换 `t` 引用触发
 * （dsh-client-ui-renderer 的 `localeSeat` 按 locale revision 缓存），走本地字典时由
 * 下面的 `useSyncExternalStore` 订阅触发。
 * @param locale 宿主 locale 服务（经插槽 inject 注入；可为 undefined）。
 * @param seatT 插槽给的 `t` seat；缺省表示本宿主组合不给 seat，整体走本地字典。
 */
export function useSchedT(locale: LocaleFaceLike | undefined, seatT?: SeatTranslate): SchedT {
  const subscribe = useCallback(
    (onStoreChange: () => void) => (locale === undefined ? noopSubscribe() : locale.subscribe(onStoreChange)),
    [locale],
  );
  const getActive = useCallback(() => (locale === undefined ? 'zh' : locale.getSnapshot().active), [locale]);
  const active = useSyncExternalStore(subscribe, getActive);
  const lang: SchedLocaleId = active === 'en' ? 'en' : 'zh';
  const t = dictFor(active);
  return { lang, t, tr: schedTranslate(seatT, active) };
}

/**
 * 组合「seat 优先 + 本地字典兜底」。
 *
 * 为什么必须有兜底，两条都有实例：
 *  1. **旧宿主组合**不给 `t`（渲染器不认条目的 `locale` 声明）→ seatT 为 undefined，
 *     整体回落本地字典。语言无法感知（没有 face 可订阅），按 v1 默认中文，与
 *     `useSchedT(undefined)` 的既有行为一致。
 *  2. **key 未注册**：宿主 `translate` 的链尾是 `?? key`，即**返回 key 本身且不抛错**。
 *     所以字典漏一个 key、或语言包把该 NS 覆盖成不完整的表，界面上会裸出
 *     `panelCount` 这种键名。这里把「返回值等于 key」判为 miss，回落本地字典。
 *
 * 注意 seat 命中本地未注册的 key 但宿主 `common` 词表有时，会用宿主的 common 值——
 * 那是期望行为（共享词表优先于插件私有文案）。
 * @param seatT 插槽给的 `t`（可为 undefined）。
 * @param localeId 兜底语言 id；缺省按 v1 行为取中文。
 * @returns 一个可直接当 `t(...)` 用的取值函数。
 */
export function schedTranslate(seatT: SeatTranslate | undefined, localeId?: string): SchedTranslate {
  const fallback = dictFor(localeId);
  if (seatT === undefined) {
    return (key, params) => (params === undefined ? fallback[key] : format(fallback[key], params));
  }
  return (key, params) => {
    const raw = params === undefined ? seatT(key) : seatT(key, params);
    // 宿主对未注册 key 返回 key 本身（`?? key`）→ 视作 miss。字典里没有任何 value
    // 与自身 key 同形，所以这个判据不会误伤正常文案。
    if (raw !== key) return raw;
    const template = fallback[key];
    return params === undefined ? template : format(template, params);
  };
}
