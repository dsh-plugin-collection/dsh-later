/**
 * 宿主**类型面**的跨代补丁层：旧内核缺的导出/字段，在本地补齐。
 *
 * 与 `upstream-compat.ts` 的分工：那个文件处理**运行期**双轨探测（鸭子类型 + 代次矩阵 +
 * 版本判定），本文件只处理**编译期**缺失的符号——没有运行期代码（全是 `type` / `interface`，
 * 编译后消失）。运行期能力降级在 `attachment-blocks.ts`（文件块在 0.1.2 要退成文本）。
 *
 * 为什么不用 `as unknown as` / `any` 糊过去（issue #95 方案 B 的边界）：那不是兼容，
 * 只是把编译错误推迟到运行期。这里的做法是「**优先复用宿主自己的类型**」：
 * 宿主这代有这个类型就直接用（结构天然一致、随宿主升级自愈），没有才按当前代形状本地声明。
 * 形状漂移会在新代 tsc 上立刻报错，而不是静默错下去。
 *
 * @module dsh-later/upstream-shims
 */
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { ContentBlockMap, ImageBlock } from '@deepseek-ai/dsh-llm';

/**
 * 从一个「可能没有某个键」的映射里取键值类型。
 *
 * 写成条件类型而不是 `M[K]`：键不存在时 `M[K]` 直接报 TS2339（`0.1.2` 的
 * `ContentBlockMap` 恰好没有 `'file'` 键），而条件类型给出 `never`——这正是
 * 「这一代没有这个块」的准确类型表达。
 */
type LookupBlock<M, K extends PropertyKey> = M extends Record<K, infer V> ? V : never;

/**
 * 附件 id 的宿主品牌类型。
 *
 * `dsh-llm` 的 `ImageBlock` / `FileBlock` 里的 `attachmentId` 是 branded
 * `AttachmentId`（定义在 `@deepseek-ai/dsh-attachment`，即 `Branded<'AttachmentId'>`）。
 * 这里既不自己造 brand（本地 `declare const … : unique symbol` 造出来的是**另一个**
 * 不兼容的 brand），也不退化成 `string`（新宿主上 `ScheduledAttachment` 就塞不进
 * `createUserMessage({ content })`），而是从宿主自己的 `ImageBlock` 引用里**继承**：
 * 宿主说 `attachmentId` 是什么类型，这里就是同一个类型。
 *
 * 为什么从 `ImageBlock` 取、而不是 `import type { AttachmentId } from '@deepseek-ai/dsh-attachment'`：
 * 本包没有把 `dsh-attachment` 声明成依赖（也不该为一条 type-only 引用去动 package.json），
 * 而 `ImageBlock` 在**全部支持代次**都存在（0.1.2-rc.1 实测有，其 `attachment` 就是
 * `ImageAttachmentRef`）——从已存在的宿主导出推导，比新增一条未声明的 import 稳。
 */
export type HostAttachmentId = ImageBlock['attachment']['attachmentId'];

/**
 * 宿主**这一代自己**的 file 块类型：`@deepseek-ai/dsh-llm` 从 **0.1.5-rc.1** 起
 * 才有 `FileBlock` / `ContentBlockMap['file']`；0.1.2-rc.1 两者都没有，于是这里是 `never`。
 */
export type HostFileBlock = LookupBlock<ContentBlockMap, 'file'>;

/**
 * 当前代（0.2.1-rc.2）`FileBlock` 的逐字段形状，供缺席的代次（0.1.2）本地声明用：
 *   `{ type: 'file'; attachment: { attachmentId: AttachmentId; name: string; bytes: number } }`
 * 即 `{ type:'file'; attachment: FileAttachmentRef }`，`FileAttachmentRef` 三字段全必需、
 * 无可选字段——故这里也全必需，**含品牌 id**（判据见 {@link FileBlockShim}）。
 */
interface FileBlockShape {
  type: 'file';
  attachment: {
    attachmentId: HostAttachmentId;
    name: string;
    bytes: number;
  };
}

/**
 * 可落 sidecar、可拼回消息 content 的 file 块类型。
 *
 * 取「宿主有就用宿主的、没有才本地声明」而不是一律本地声明，是为了让**结构一致性由构造
 * 保证**，不是靠人肉对齐：
 *  - 0.1.5-rc.1 起：直接就是宿主那一代的 `FileBlock`，`ScheduledAttachment` 与今天
 *    （`ImageBlock | FileBlock`）**逐类型相同**，不存在漂移空间；
 *  - 0.1.2-rc.1：宿主没有这个类型，退到 {@link FileBlockShape}（形状抄当前代）。
 *    注意这一代**运行期也不认** file 块（`ContentBlock` 联合里没有该变体），所以
 *    拼消息时必须降级成文本——见 `attachment-blocks.ts` 的 `FILE_BLOCK_SINCE`。
 *
 * 它不是 `as unknown as` 的等价物：块**本身**是宿主在命令准入时交给我们的对象，本插件
 * 只做存储/透传（issue #95 方案 B 的边界），形状必须与宿主逐字段一致。
 */
export type FileBlockShim = [HostFileBlock] extends [never] ? FileBlockShape : HostFileBlock;

/**
 * 带 `attachments` 声明的命令输入描述符。
 *
 * 缺口代次：`CommandInputDescriptor.attachments` 是 **0.1.5-rc.1** 起才有的字段
 * （0.1.2 的 `CommandInputDescriptor` 只有 `hint` 与 `images`，0.1.5 起把 `images`
 * 换成了 `attachments`）。但这个声明**必须照传**：新宿主靠它做 composer 附件准入，缺了就
 * 回到「有图片时 /later 发不出去」；老宿主不认识该字段直接忽略，行为不变。
 *
 * 用法约束（关键是第二句）：**先把对象字面量赋值给这个类型的变量**，再把变量放进
 * `CommandDefinition.input`。直接把带 `attachments` 的字面量塞进 `input` 会触发
 * 对象字面量的过多属性检查（TS2353，正是本 shim 要消掉的那条错）；变量赋值只做
 * 结构检查，多出来的字段被交叉类型的第二个成员吸收。
 */
export type CommandInputWithAttachments = NonNullable<CommandDefinition['input']> & {
  readonly attachments?: boolean;
};
