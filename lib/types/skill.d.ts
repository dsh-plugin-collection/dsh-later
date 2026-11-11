import type { HostLocaleId } from './strings.js';
export declare const SKILL_NAME = "later-reminders";
export declare const SKILL_PROVIDER = "dsh-later";
export interface ParsedSkill {
    readonly description: string;
    readonly content: string;
}
export interface SkillCandidateLike {
    readonly name: string;
    readonly description: string;
    readonly invocation: {
        readonly modelInvocable: boolean;
        readonly userInvocable: boolean;
    };
    readonly source: string;
    readonly provider: string;
    readonly path?: string;
    readonly resourceBase?: {
        readonly kind: 'directory';
        readonly path: string;
    };
    readonly rank: number;
    readonly locator: unknown;
}
export interface SkillDefinitionLike extends Omit<SkillCandidateLike, 'rank' | 'locator'> {
    readonly content: string;
}
export interface SkillProviderLike {
    readonly name: string;
    list(options: {
        readonly cwd?: string;
        readonly signal?: AbortSignal;
    }): Promise<readonly SkillCandidateLike[]>;
    get(candidate: SkillCandidateLike): Promise<SkillDefinitionLike | undefined>;
}
export interface SkillRegistryLike {
    registerProvider(create: (control: unknown) => SkillProviderLike): () => void;
}
export interface SkillsContextLike {
    readonly skills?: SkillRegistryLike;
}
export interface SkillHostLike {
    readonly inject?: ((deps: readonly string[], callback: (skillCtx: SkillsContextLike) => void) => unknown);
    readonly logger?: {
        warn?: (message: string) => unknown;
    };
}
export declare function parseSkill(raw: string, label?: string): ParsedSkill;
export declare function skillFilePaths(rootDir?: string): Record<HostLocaleId, string>;
export declare function resolveSkillLocale(localeId: string | undefined): HostLocaleId;
export declare function laterSkillProvider(getLocale?: () => string | undefined, paths?: Record<HostLocaleId, string>, onWarn?: (message: string) => void): SkillProviderLike;
export declare function registerBundledSkill(host: SkillHostLike, getLocale: () => string | undefined): void;
