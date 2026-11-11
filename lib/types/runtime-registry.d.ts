export type MountDisposer = () => void | Promise<void>;
export interface RegistryAgent {
    readonly id: string;
}
export interface RuntimeRegistryOptions<A extends RegistryAgent, R> {
    roots(): readonly A[];
    create(agent: A): R;
    attach(agent: A, runtime: R): MountDisposer;
    drive(runtime: R): void;
    warn(message: string): void;
    isStopping(): boolean;
}
export interface RuntimeRegistry<A extends RegistryAgent, R> {
    mount(agent: A): R | undefined;
    ensure(agent: A): R | undefined;
    hydrate(): number;
    drive(agent: A): boolean;
    get(agent: A): R | undefined;
    size(): number;
    forget(agent: A, runtime: R): void;
    unmountAll(): Promise<number>;
}
export declare function createRuntimeRegistry<A extends RegistryAgent, R>(options: RuntimeRegistryOptions<A, R>): RuntimeRegistry<A, R>;
