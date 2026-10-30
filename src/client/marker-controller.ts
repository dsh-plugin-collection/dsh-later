/**
 * 气泡标记的注册生命期（issue #112）。
 *
 * 规则只有一条：**`bubbleMarker` 是 `off` 时不注册渲染器**。注册/销毁条目不是装饰，
 * 而是接管官方 `user` / `steering` 行；`off` 必须真的把渲染还给官方。
 *
 * 能力门禁（不按版本号猜）：
 *  - `conversation.chat.node` 的 spec 必须是 `keyed`；
 *  - `conversation.chat.user.images` 必须已被声明。后者是 0.2.1 才引入的
 *    `conversation.chat.user.content` factory 的子槽，它的存在就证明「官方气泡工厂 +
 *    renderFactorySlot 席位」这一套在本代次可用。0.2.0 及更早没有它，不注册。
 *
 * priority 用 -10：官方两条在默认 0，同 key 同 priority 的第二次注册会抛错，
 * 而**最低 priority 渲染**，所以负值才能影子成功。条目销毁后官方条目自动回到渲染位。
 * @module dsh-later/client/marker-controller
 */
import type { ComponentType } from 'react';
import type {
  ClientConfigForm,
  ClientSettingsScope,
  ClientSlotRegistry,
} from './runtime-augment.js';
import { planBubbleMarker, resolveBubbleMarker } from '../bubble-marker.js';
import { LaterUserMessageView } from './components/LaterUserMessageView.js';
import type { LocaleFaceLike } from './useSchedT.js';

/** 节点槽（keyed，`user` / `steering` 两个 cell）。 */
const NODE_SLOT = 'conversation.chat.node';
/** 官方用户内容工厂的子槽：0.2.1 起才声明，作为「工厂可用」的能力探针。 */
const CONTENT_PROBE_SLOT = 'conversation.chat.user.images';
/** 被接管的两个 cell。 */
const NODE_KEYS = ['user', 'steering'] as const;
/** 影子优先级：官方在 0，最低者渲染。 */
const SHADOW_PRIORITY = -10;

/** 挂载所需的宿主面。 */
export interface BubbleMarkerHost {
  readonly slots: ClientSlotRegistry;
  readonly scope: ClientSettingsScope | ClientConfigForm;
  readonly locale?: LocaleFaceLike;
}

/** 注册失败只告警一次：设置变更/重载会反复走到这里，刷屏会淹掉真问题。 */
let warned = false;
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  try {
    console.warn(`dsh-later: 气泡标记未注册：${message}`);
  } catch {
    /* 告警出口失败不影响渲染 */
  }
}

/**
 * 挂载气泡标记控制器：订阅设置，按档位注册/销毁 `user` + `steering` 渲染器。
 * @param host - slots 注册面、设置 scope、可选 locale。
 * @param host.slots - 客户端插槽服务。
 * @param host.scope - 设置 scope（settingsScope 或 configForms）。
 * @param host.locale - locale 服务（缺失时文案回退中文）。
 * @returns 卸载函数：撤销订阅与全部条目。
 */
export function mountBubbleMarker(host: BubbleMarkerHost): () => void {
  let nodeReady = false;
  let contentReady = false;
  let disposers: Array<() => void> = [];

  const disposeEntries = (): void => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch {
        /* 尽力而为：一个拆不掉不该阻断其余拆除 */
      }
    }
  };

  /** 注册两个 key；失败只告警一次，不阻断另一半。 */
  const registerEntries = (): void => {
    const inject = (): Record<string, unknown> => ({
      schedulerScope: host.scope,
      ...(host.locale === undefined ? {} : { locale: host.locale }),
    });
    for (const key of NODE_KEYS) {
      try {
        disposers.push(
          host.slots.register(
            { name: NODE_SLOT, key, priority: SHADOW_PRIORITY, inject },
            LaterUserMessageView as unknown as ComponentType<unknown>,
          ),
        );
      } catch (error) {
        warnOnce(`${NODE_SLOT}[${key}] ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  /** 按当前设置与能力，把「该不该有渲染器」收敛到目标状态（决策表在 bubble-marker）。 */
  const sync = (): void => {
    const snapshot = host.scope.getSnapshot();
    if (snapshot.status !== 'ready') {
      disposeEntries();
      return;
    }
    const spec = host.slots.spec?.(NODE_SLOT);
    const plan = planBubbleMarker({
      style: resolveBubbleMarker(snapshot),
      nodeReady,
      contentReady,
      registered: disposers.length > 0,
      ...(spec === undefined ? {} : { nodeSlotKind: spec.kind }),
    });
    if (plan === 'register') registerEntries();
    else if (plan === 'off') disposeEntries();
  };

  // 两个 inject 都要等：节点槽存在，且用户内容工厂（经由它的子槽）已声明。
  const offContent = host.slots.inject(CONTENT_PROBE_SLOT, () => {
    contentReady = true;
    sync();
    return () => {
      contentReady = false;
      disposeEntries();
    };
  });
  const offNode = host.slots.inject(NODE_SLOT, () => {
    nodeReady = true;
    sync();
    return () => {
      nodeReady = false;
      disposeEntries();
    };
  });
  const offScope = host.scope.subscribe(sync);
  // 绑定这一刻设置可能已经 ready，先收敛一次。
  sync();

  return () => {
    // 测试桩/旧宿主的 inject/subscribe 可能返回 undefined：清理只认函数，不为空值抛错。
    for (const stop of [offScope, offNode, offContent]) {
      if (typeof stop === 'function') stop();
    }
    disposeEntries();
  };
}
