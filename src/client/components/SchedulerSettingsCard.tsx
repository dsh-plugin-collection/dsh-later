import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { isValidHhmm } from '../../smart-window.js';

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
}

/** 字段元数据（顺序固定，便于稳定渲染）。 */
type FieldDef =
  | {
      readonly kind: 'boolean';
      readonly key: 'showButton' | 'confirmDelivery';
      readonly labelKey: string;
      readonly hintKey?: string;
      readonly defaultValue: boolean;
    }
  | { readonly kind: 'number'; readonly key: 'maxSchedules'; readonly labelKey: string; readonly hintKey: string; readonly defaultValue: number }
  | { readonly kind: 'time'; readonly key: 'workStart' | 'workEnd' | 'lunchStart' | 'lunchEnd' | 'eveningEnd'; readonly labelKey: string; readonly hintKey?: string }
  | { readonly kind: 'enum'; readonly key: 'steerDelivery' | 'onUnconfirmed' | 'clockIconStyle'; readonly labelKey: string; readonly hintKey?: string; readonly options: readonly string[]; readonly defaultValue: string };

/** Section 分组（对齐官方插件设置页的 section 结构）。 */
interface SectionDef {
  readonly id: string;
  readonly titleKey: string;
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
        kind: 'enum',
        key: 'clockIconStyle',
        labelKey: 'clockIconStyleLabel',
        hintKey: 'clockIconStyleHint',
        options: ['auto', 'modern', 'classic'],
        defaultValue: 'auto',
      },
      { kind: 'number', key: 'maxSchedules', labelKey: 'maxSchedulesLabel', hintKey: 'maxSchedulesHint', defaultValue: 100 },
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
] as const;

const FIELDS: readonly FieldDef[] = SECTIONS.flatMap((s) => s.fields);

/** 单字段的 pending 编辑意图：`{value, reset:true}` 表示点击 reset 等待保存。 */
type Pending = { readonly value: string; readonly reset: boolean };
type PendingMap = Partial<Record<string, Pending>>;

export interface SchedulerSettingsCardProps {
  scope: SettingsScope<SchedulerSettings>;
  t: (key: string) => string;
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
 * 状态模型：每个字段维护独立的 `pending` 中间态（待保存的 value + reset 意图）；
 * 保存时按字段批量写。`reset` 表示「点击了 reset 按钮但尚未保存」，实际写入
 * 由 save 统一调用 `unset` 完成。空串视为「回退默认」→ unset。
 */
export function SchedulerSettingsCard({ scope, t }: SchedulerSettingsCardProps): JSX.Element {
  const [snapshot, setSnapshot] = useState(() => scope.getSnapshot());
  const [pending, setPending] = useState<PendingMap>({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  /** 帮助按钮展开态（对齐官方 _helpButton_：aria-expanded 切换） */
  const [helpOpen, setHelpOpen] = useState<Readonly<Record<string, boolean>>>({});

  useEffect(() => {
    const initial = scope.getSnapshot();
    setSnapshot(initial);
    setPending({});
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
      return v === false ? 'false' : 'true';
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
      return v === false ? 'false' : 'true';
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

  const handleSave = useCallback(async () => {
    if (!dirty || saving || !writable) return;
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
  }, [scope, pending, dirty, saving, writable]);

  // 校验所有 pending 字段（已弃 dirty 字段忽略）。
  const invalidField = (field: FieldDef): string | null => {
    const p = pending[field.key];
    if (p === undefined) return null;
    return validate(field, p.value);
  };
  const anyInvalid = FIELDS.some((field) => invalidField(field) !== null);
  const saveDisabled = !dirty || saving || !writable || anyInvalid;

  /**
   * 「投递确认」当前是否开启（pending 优先于已保存）—— 决定 steer 风险文案的口径。
   * 默认 true（与 schema 一致：未设置即为开）。
   */
  const confirmEnabled =
    (pending.confirmDelivery?.value ?? (value.confirmDelivery === false ? 'false' : 'true')) !== 'false';

  return (
    <div className="ss-settings-form">
      {!writable && (
        <p className="ss-hint" role="status">
          {t('readOnly')}
        </p>
      )}

      {SECTIONS.map((section) => (
        <section className="ss-section" key={section.id} aria-labelledby={`ss-section-${section.id}`}>
          <h3 className="ss-section-heading" id={`ss-section-${section.id}`}>
            {t(section.titleKey)}
          </h3>
          <div className={section.layout === 'grid' ? 'ss-section-fields ss-section-fieldsGrid' : 'ss-section-fields'}>
            {section.fields.map((field) => {
              const invalid = invalidField(field);
              const isTime = field.kind === 'time';
              const labelKey = field.labelKey;
              const hintKey = field.hintKey;
              const userHas = isUserOverridden(field.key);
              const fieldId = `ss-${field.key}`;
              const helpHint = hintKey !== undefined && t(hintKey).length > 0;
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
                  <div className="ss-field ss-fieldToggle" key={field.key}>
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
                      <label htmlFor={fieldId} className="ss-card-label">
                        {t(labelKey)}
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
                          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" strokeWidth="1">
                            <path d="M12.5757 7.00012C12.5757 3.92085 10.0794 1.42463 7.00012 1.42456C3.9208 1.42456 1.42456 3.9208 1.42456 7.00012C1.42463 10.0794 3.92085 12.5757 7.00012 12.5757C10.0793 12.5756 12.5756 10.0793 12.5757 7.00012ZM13.8002 7.00012C13.8001 10.7559 10.7559 13.8001 7.00012 13.8002C3.2443 13.8002 0.199291 10.7559 0.199219 7.00012C0.199219 3.24426 3.24426 0.199219 7.00012 0.199219C10.7559 0.199291 13.8002 3.2443 13.8002 7.00012Z" fill="currentColor"/>
                            <path d="M7.6127 3.18921V4.55986H6.38735V3.18921H7.6127Z" fill="currentColor"/>
                            <path d="M7.6127 5.68921V10.8109H6.38735V5.68921H7.6127Z" fill="currentColor"/>
                          </svg>
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
                      className={invalid !== null ? 'ss-input ss-inputInvalid' : 'ss-input'}
                      aria-invalid={invalid !== null || undefined}
                      value={displayValue(field)}
                      placeholder={field.kind === 'number' ? String(field.defaultValue) : undefined}
                      disabled={!writable || saving}
                      onChange={(event) => handleFieldEdit(field, event.target.value)}
                    />
                  )}
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
