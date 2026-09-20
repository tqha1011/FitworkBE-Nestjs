export abstract class IApplicationCache {
  abstract get<T>(key: string): Promise<T | undefined>;
  abstract set<T>(key: string, value: T): Promise<void>;
  abstract delete(key: string): Promise<void>;
}
