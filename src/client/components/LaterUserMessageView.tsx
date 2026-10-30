/**
 * 定时消息（`/later` 代发）的气泡标记渲染器（issue #112）。
 *
 * 这个组件替换的是官方 `conversation.chat.node` 的 `user` / `steering` 两个 key，
 * 所以**所有**用户消息都从这里出去，不只是定时消息。因此：
 *
 *  - 气泡内容不自己画：调官方 factory `conversation.chat.user.content`，气泡、图片、
 *    引用摘要、附件全部沿用官方实现；工厂缺席时退到一条纯文本气泡（宁可难看，不可消失）。
 *  - 操作行（时间 + 复制）必须复刻：官方 `MessageIconActions` 在替换后不再渲染。
 *  - 没有 `source.later` 的消息只多一层等价的行容器，不加任何装饰。
 *
 * 三档标记由 `bubbleMarker` 设置决定（`left` / `meta` / `hover`），`off` 根本不会注册。
 * 有附件时按附件行高度补偿，标记仍对齐气泡首行，不落在图片顶边。
 * @module dsh-later/client/components/LaterUserMessageView
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  IconCheck,
  IconClock,
  IconCopy,
  tooltipPortalProps,
  writeClipboardCompat,
} from '../primitives-compat.js';
import { useSchedT, type LocaleFaceLike, type SchedTranslate } from '../useSchedT.js';
import { readLaterMarker, type LaterUserMessageMarker } from '../../later-message-source.js';
import {
  useSchedulerSettings,
  type BubbleMarkerStyle,
  type SchedulerSettingsScopeLike,
} from '../hooks/useSchedulerSettings.js';

/** 官方 user/steering 节点 data 里本组件用到的子集（客户端不引 dsh-llm 运行时）。 */
interface UserNodeData {
  readonly time?: number;
  readonly content?: readonly unknown[];
  readonly source?: unknown;
  readonly referenceLabels?: readonly string[];
  readonly skillNames?: readonly string[];
}

/** 工厂席位（宿主按条目注入；旧代次可能没有，故可选）。 */
type FactorySeat = (
  name: string,
  props: Record<string, unknown>,
  options?: { fallback?: ReactNode },
) => ReactNode;

/** 插槽条目的 props：owner 提供 node/loadImage，标准件提供 renderFactorySlot，inject 提供设置 scope 与 locale。 */
export interface LaterUserMessageProps {
  readonly node?: { readonly data?: UserNodeData };
  readonly loadImage?: unknown;
  readonly renderFactorySlot?: FactorySeat;
  readonly schedulerScope?: SchedulerSettingsScopeLike;
  readonly locale?: LocaleFaceLike;
}

/** 准备后的用户内容（与官方 `contentParts` / `UserStyleBubble` 的入参同形）。 */
interface PreparedContent {
  readonly text: string;
  readonly attachments: readonly unknown[];
  readonly extraBlocks: readonly unknown[];
  readonly referenceLabels?: readonly string[];
}

/** 与官方 `contentParts` 同口径：文本拼接、带 attachment 的 image/file 进附件、其余进 extraBlocks。 */
function prepareContent(data: UserNodeData): PreparedContent {
  const texts: string[] = [];
  const attachments: unknown[] = [];
  const rest: unknown[] = [];
  for (const block of data.content ?? []) {
    if (block === null || typeof block !== 'object') {
      rest.push(block);
      continue;
    }
    const record = block as Record<string, unknown>;
    if (record['type'] === 'text' && typeof record['text'] === 'string') {
      texts.push(record['text']);
    } else if (record['type'] === 'image' && record['attachment'] !== undefined) {
      attachments.push({ type: 'image', image: { attachment: record['attachment'] } });
    } else if (record['type'] === 'file' && record['attachment'] !== undefined) {
      attachments.push({ type: 'file', file: record['attachment'] });
    } else {
      rest.push(block);
    }
  }
  const text = texts.join('');
  return {
    text,
    attachments,
    extraBlocks: rest,
    ...(data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }),
  };
}

/** 两个补零。 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 本地零点（毫秒）。 */
function startOfLocalDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 复刻官方 `formatMessageClock`：当天 `HH:mm`；同年 `M月D日 HH:mm`；跨年 `Y年M月D日 HH:mm`。
 * 月份/日/年的分隔由字典给（zh/en 两套），与官方 chat 的 `clock.md` / `clock.ymd` 逐字一致。
 */
function formatClock(time: number, dayStart: number, tr: SchedTranslate): string {
  const date = new Date(time);
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (startOfLocalDay(time) === dayStart) return clock;
  const sameYear = new Date(dayStart).getFullYear() === date.getFullYear();
  const params = { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
  return `${tr(sameYear ? 'clockMd' : 'clockYmd', params)} ${clock}`.trim();
}

/** 本地日历日：跨过零点后重渲染一次，时间文案才不会一直停在「今天」。 */
function useLocalDay(): number {
  const [day, setDay] = useState(() => startOfLocalDay(Date.now()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      const now = Date.now();
      setDay(startOfLocalDay(now));
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      timer = setTimeout(arm, Math.max(1_000, next.getTime() - now));
    };
    const next = new Date(Date.now());
    next.setHours(24, 0, 0, 0);
    timer = setTimeout(arm, Math.max(1_000, next.getTime() - Date.now()));
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
  return day;
}

/** 复刻的操作行：时间 + 复制（官方 `MessageIconActions` 在替换后不再渲染）。 */
function LaterMessageActions(props: { readonly text: string; readonly time: number; readonly locale?: LocaleFaceLike }): JSX.Element {
  const { tr } = useSchedT(props.locale);
  const day = useLocalDay();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
    },
    [],
  );
  const onCopy = useCallback(() => {
    void writeClipboardCompat(props.text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1000);
    });
  }, [props.text]);
  const clock = formatClock(props.time, day, tr);
  const label = copied ? tr('actionCopied') : tr('actionCopy');
  return (
    <div className="ss-later-actions">
      <span className="ss-later-time">{clock}</span>
      <Tooltip label={label} side="bottom" delayMs={500} {...tooltipPortalProps}>
        <button type="button" className="ss-later-copy" aria-label={label} onClick={onCopy}>
          {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
        </button>
      </Tooltip>
    </div>
  );
}

/** 标记的 aria / tooltip 文案。 */
function markerText(
  marker: LaterUserMessageMarker | undefined,
  clock: string,
  tr: SchedTranslate,
): { readonly aria: string; readonly tip: string } {
  const merged = marker !== undefined && marker.count > 1;
  return {
    aria: tr('laterMarkerAria', { time: clock }),
    tip: merged
      ? tr('laterMarkerTooltipBatch', { time: clock, count: marker.count })
      : tr('laterMarkerTooltip', { time: clock }),
  };
}

/**
 * 一个用户消息行：官方内容工厂 + 可选的定时标记 + 复刻的操作行。
 * @param props - 节点、工厂/图片席位、设置 scope 与 locale。
 * @returns 与会话流兼容的一行。
 */
export function LaterUserMessageView(props: LaterUserMessageProps): JSX.Element {
  const { node, renderFactorySlot, loadImage, schedulerScope, locale } = props;
  const settings = useSchedulerSettings(schedulerScope);
  const { tr } = useSchedT(locale);
  const day = useLocalDay();
  const data = node?.data ?? {};
  const marker = readLaterMarker(data.source);
  const style: BubbleMarkerStyle = settings.bubbleMarker;
  const decorated = marker !== undefined && style !== 'off';
  const prepared = prepareContent(data);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const [markOffset, setMarkOffset] = useState(13);

  /**
   * 有附件时把标记下移到气泡首行：附件行高度 + 栈内 8px 间距 + 气泡 13px 基准。
   * 读不到附件行（`data-message-attachments` 缺失）就保持 13px，只影响观感。
   */
  const measure = useCallback(() => {
    const wrap = stackRef.current;
    const stack = wrap?.firstElementChild;
    const first = stack?.firstElementChild as HTMLElement | null | undefined;
    if (first !== undefined && first !== null && first.hasAttribute('data-message-attachments')) {
      setMarkOffset(first.offsetHeight + 8 + 13);
      return;
    }
    setMarkOffset(13);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, data.content, style]);

  useEffect(() => {
    if (style !== 'left' && style !== 'hover') return undefined;
    if (typeof ResizeObserver === 'undefined') return undefined;
    const first = stackRef.current?.firstElementChild?.firstElementChild;
    if (first === undefined || first === null) return undefined;
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(first);
    return () => {
      observer.disconnect();
    };
  }, [measure, style, data.content]);

  const facts = useMemo(
    () => ({
      ...(data.referenceLabels === undefined ? {} : { sessionLabels: data.referenceLabels }),
      ...(data.skillNames === undefined ? {} : { skillNames: data.skillNames }),
    }),
    [data.referenceLabels, data.skillNames],
  );

  /**
   * 官方内容工厂。`fallback` 是旧代次/异常时的兜底：宁可画一条朴素气泡，
   * 也不能让用户消息凭空消失。
   */
  const content = useMemo(() => {
    if (renderFactorySlot === undefined) {
      return <div className="ss-later-fallback">{prepared.text}</div>;
    }
    return renderFactorySlot(
      'conversation.chat.user.content',
      { content: prepared, loadImage, facts, interactive: true },
      { fallback: <div className="ss-later-fallback">{prepared.text}</div> },
    );
  }, [facts, loadImage, prepared, renderFactorySlot]);

  const clock = formatClock(data.time ?? Date.now(), day, tr);
  const text = markerText(marker, clock, tr);
  const mark = (
    <span
      className="ss-later-mark"
      role="img"
      aria-label={text.aria}
      data-tip={text.tip}
      data-ss-later-mark=""
      style={{ marginTop: `${markOffset}px` }}
    >
      <IconClock size={16} />
    </span>
  );

  const stack = (
    <div className="ss-later-stackwrap" ref={stackRef}>
      {content}
    </div>
  );

  const actions = <LaterMessageActions text={prepared.text} time={data.time ?? Date.now()} locale={locale} />;

  if (!decorated) {
    return (
      <div className="ss-later-row" data-ss-later-row="">
        {stack}
        {actions}
      </div>
    );
  }

  if (style === 'meta') {
    return (
      <div className="ss-later-row" data-ss-later-row="" data-ss-marker="meta">
        <div className="ss-later-meta">
          <IconClock size={13} />
          {tr('laterMarkerMeta', { time: clock })}
        </div>
        {stack}
        {actions}
      </div>
    );
  }

  return (
    <div className="ss-later-row" data-ss-later-row="" data-ss-marker={style}>
      <div className="ss-later-main">
        {mark}
        {stack}
      </div>
      {actions}
    </div>
  );
}
