/**
 * 输入框右侧的定时按钮 + 倒计时芯片（PRD §3.2.1 / §3.2.5 / docs/ui 01 §1）。
 * 注册在 `conversation.input.right` 插槽（order 50）。
 *
 * 逻辑已抽取到 `useSchedules` hook；本组件只负责渲染。
 * @module dsh-later/client/components/SchedButton
 */
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { IconClockOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { detectTimeZone } from '../../time-utils.js';
import { useSchedT, type LocaleFaceLike } from '../useSchedT.js';
import type { ClientSchedule, CreateCommandPayload } from '../types.js';
import type { CommandOutcome } from '../../command-outcome.js';
import { SchedPanel } from './SchedPanel.js';
import { useSchedules } from '../hooks/useSchedules.js';
import { useSchedulerSettings, type SchedulerSettingsScopeLike } from '../hooks/useSchedulerSettings.js';
import { useEscapeToClose, hasOfficialOutsideDismiss, usePanelOutsideDismiss } from '../primitives-compat.js';

/** 应用层注入的调用能力。 */
export interface SchedButtonInjected {
  /** 向宿主执行一条 slash 命令；返回是否受理（`matched`）。 */
  callCommand: (sessionId: string, line: string) => Promise<CommandOutcome>;
  /** 宿主 locale 服务（跟随 DSH 界面语言；缺失回退中文）。 */
  locale?: LocaleFaceLike;
  /** 插件设置 scope（设置页保存后智能时段即时生效；缺失回退默认）。 */
  schedulerScope?: SchedulerSettingsScopeLike;
}

/** 会话作用域插槽条目收到的标准 props + 注入。 */
export interface SchedButtonProps extends SchedButtonInjected {
  /** InputZone owner 提供的输入快照。 */
  input?: { readonly draft: string };
  /** 会话作用域标准 hook：读取草稿。 */
  useInput?: (selector: (state: { draft: string }) => string) => string;
  /** 会话作用域标准 hook：读取投影。 */
  useProjection?: (key: string) => { schedules?: readonly ClientSchedule[] } | undefined;
  /** 会话 id。 */
  sessionId?: string;
  /** 输入动作：清空输入框。 */
  inputActions?: { setDraft(text: string): void };
}

export function SchedButton(props: SchedButtonProps): JSX.Element | null {
  const { callCommand, sessionId, inputActions, input, useProjection, useInput, locale, schedulerScope } = props;
  const { lang, t } = useSchedT(locale);
  const { smartWindow, promptLimits, showButton } = useSchedulerSettings(schedulerScope);
  const [open, setOpen] = useState(false);

  const {
    draft,
    schedules,
    enabled,
    busy,
    anchorBottom,
    reposition,
    handleCreate,
    handleDelete,
    rowRef,
  } = useSchedules({
    callCommand,
    sessionId,
    inputActions,
    input,
    useProjection,
    useInput,
  });

  /**
   * Esc 关闭从本组件移进 compat 层（`useEscapeToClose`），使 0.2.0+ 与旧代次走
   * 同一条键盘路径。下方 `open` 副作用因此只保留 resize 重新定位。
   */
  useEscapeToClose(open, setOpen);
  useEffect(() => {
    if (!open) return undefined;
    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [open, reposition]);

  /**
   * 点击「按钮 + 面板」之外关闭（官方 `useDismissOnOutsidePointer`）。
   *
   * 面板已 portal 到 `document.body`，不在 `rowRef` 子树内，故须把面板 ref 一并
   * 交给它（官方 `Menu` 的 portal 用法同款）。旧代次无此 hook 时该调用是空实现，
   * 关闭退回到下面的 `.ss-backdrop` 全屏遮罩。
   */
  const panelRef = useRef<HTMLDivElement | null>(null);
  usePanelOutsideDismiss(rowRef, open, setOpen, panelRef);

  // 设置「显示定时按钮」关闭时隐藏整个插槽条目（含面板入口）。
  // 提醒触发（宿主调度）与 dock 列表不受影响；所有 hook 均已在此前调用，
  // 提前返回不违反 React hooks 顺序约束。
  if (!showButton) return null;

  const handleCreateWithErrorBoundary = async (inputPayload: CreateCommandPayload): Promise<void> => {
    try {
      await handleCreate(inputPayload);
    } catch {
      setOpen(false);
      throw new Error(t.editErrNotAccepted);
    }
  };

  return (
    <span ref={rowRef} className="ss-sched-row" data-ss-sched-row="">
      <button
        type="button"
        className={open ? 'ss-sched-btn ss-active' : 'ss-sched-btn'}
        title={t.buttonSchedule}
        aria-label={t.buttonSchedule}
        aria-expanded={open}
        disabled={!enabled}
        onClick={() => setOpen((value) => !value)}
      >
        <IconClockOutlineRegular size={16} />
      </button>
      {open && (
        <>
          {/*
            全屏遮罩**只在旧代次**渲染（官方 outside-pointer 不可用时）。
            0.2.0+ 上它是多余的：面板已 portal 到 body，点击外面由
            `usePanelOutsideDismiss` 判定，而这张 `inset: 0` 的透明层会
            顺手拦掉页面滚动与焦点移动。
          */}
          {!hasOfficialOutsideDismiss && (
            <div className="ss-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          )}
          <SchedPanel
            defaultPrompt={draft}
            schedules={schedules}
            timeZone={detectTimeZone()}
            busy={busy}
            t={t}
            lang={lang}
            onClose={() => setOpen(false)}
            onCreate={handleCreateWithErrorBoundary}
            onDelete={(id) => void handleDelete(id)}
            bottom={anchorBottom}
            anchorRef={rowRef}
            panelRef={panelRef}
            smartWindow={smartWindow}
            promptLimits={promptLimits}
          />
        </>
      )}
    </span>
  );
}
