import { AsyncLocalStorage } from "node:async_hooks";

export interface AsyncScope<T extends object> {
  current: T;
  run<R>(value: T, callback: () => R): R;
}

export function createAsyncScope<T extends object>(label: string): AsyncScope<T> {
  const storage = new AsyncLocalStorage<T>();
  const unavailable = () => {
    throw new Error(`${label} is unavailable outside a request scope`);
  };

  const current = new Proxy({} as T, {
    get(_target, property) {
      const value = storage.getStore();
      if (!value) {
        return unavailable();
      }

      const propertyValue = Reflect.get(value, property);
      return typeof propertyValue === "function"
        ? propertyValue.bind(value)
        : propertyValue;
    },
  });

  return {
    current,
    run(value, callback) {
      return storage.run(value, callback);
    },
  };
}
