import { createContext, useContext } from 'react';

// Optional in ERP; mandatory for the portable host. Never changes global fetch.
const RuntimeAdapters = createContext(null);
const browserFetch = (...args) => globalThis.fetch(...args);
export const RuntimeAdaptersProvider = RuntimeAdapters.Provider;
export function useRuntimeAdapters() { return useContext(RuntimeAdapters); }
export function useRuntimeFetch() {
  return useRuntimeAdapters()?.transport.fetch ?? browserFetch;
}
