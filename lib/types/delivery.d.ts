import type { Session } from '@deepseek-ai/dsh-session';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
export type DeliveryMode = 'followup' | 'steer';
export declare const DELIVERY_CONFIRM_TIMEOUT_MS = 2000;
export declare function hasMessageInLog(session: Session, messageId: string): boolean;
export declare function confirmDelivery(session: Session, messageId: string, timeoutMs?: number): Promise<boolean>;
export declare function messageIdOf(message: UserMessage): string;
