interface ProjectionRegistryLike {
    register(definition: never): unknown;
}
export type ProjectionDisposer = () => void | Promise<void>;
export declare function registerUserSchedulesProjection(registry: ProjectionRegistryLike, warn?: (message: string) => void): Promise<ProjectionDisposer>;
export {};
