import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { ContentBlockMap, ImageBlock } from '@deepseek-ai/dsh-llm';
type LookupBlock<M, K extends PropertyKey> = M extends Record<K, infer V> ? V : never;
export type HostAttachmentId = ImageBlock['attachment']['attachmentId'];
export type HostFileBlock = LookupBlock<ContentBlockMap, 'file'>;
interface FileBlockShape {
    type: 'file';
    attachment: {
        attachmentId: HostAttachmentId;
        name: string;
        bytes: number;
    };
}
export type FileBlockShim = [HostFileBlock] extends [never] ? FileBlockShape : HostFileBlock;
export type CommandInputWithAttachments = NonNullable<CommandDefinition['input']> & {
    readonly attachments?: boolean;
};
export {};
