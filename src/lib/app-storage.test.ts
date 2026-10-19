// Persistence mirrors the app's mutable tree into a throttled IndexedDB
// snapshot, and `useIDBKeyval` broadcasts every write to other tabs. The pair
// worth pinning down is a remote update that lands while this tab still has a
// trailing snapshot queued: the queue must not re-publish the value it just
// received, and it must not lock out the tab's own next edit.
//
// Runs in the `node` test environment, so VueUse's browser detection and
// IndexedDB are stubbed: `defaultWindow` is captured while @vueuse/shared is
// evaluated, which is why the globals are installed in a hoisted block.
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { update } from "idb-keyval";

const environment = vi.hoisted(() => {
  const globalScope = globalThis as unknown as Record<string, unknown>;
  globalScope.window = globalThis;
  globalScope.document = { createElement: () => ({ style: {} }) };
  return { store: new Map<string, unknown>() };
});

vi.mock("idb-keyval", () => {
  const clone = (value: unknown) =>
    value === undefined ? value : structuredClone(value);

  return {
    get: vi.fn(async (key: string) => environment.store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      environment.store.set(key, clone(value));
    }),
    update: vi.fn(
      async (key: string, updater: (current: unknown) => unknown) => {
        environment.store.set(key, clone(updater(environment.store.get(key))));
      },
    ),
    del: vi.fn(async (key: string) => {
      environment.store.delete(key);
    }),
  };
});

const { usePersistentState } = await import("@/lib/app-storage");

interface Item {
  id: string;
}

const KEY = "conversations:v3";

/** Longer than a macrotask, shorter than the 300ms throttle window. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Past the trailing edge of the throttle, so a queued write has run or not. */
const pastThrottle = () => new Promise((resolve) => setTimeout(resolve, 400));

function writeCount(): number {
  return vi.mocked(update).mock.calls.length;
}

describe("usePersistentState", () => {
  beforeEach(() => {
    environment.store.clear();
    vi.clearAllMocks();
  });

  it("does not re-publish a remote update that arrives while a snapshot is queued", async () => {
    const tabA = usePersistentState<Item[]>(KEY, []);
    const tabB = usePersistentState<Item[]>(KEY, []);
    await Promise.all([tabA.hydrated, tabB.hydrated]);

    tabA.state.value.push({ id: "a1" });
    await nextTick();
    await tick();
    expect(writeCount()).toBe(1);
    expect(tabB.state.value).toEqual([{ id: "a1" }]);

    // Inside the throttle window, so this edit is only queued for later.
    tabA.state.value.push({ id: "a2" });
    await nextTick();
    expect(writeCount()).toBe(1);

    // The other tab writes, and this tab adopts that value while its own
    // queued snapshot is still pending.
    tabB.state.value.push({ id: "b1" });
    await nextTick();
    await tick();
    expect(writeCount()).toBe(2);
    expect(tabA.state.value).toEqual([{ id: "a1" }, { id: "b1" }]);

    // Past the queued trailing edge: re-cloning the adopted value would write
    // and broadcast bytes that are already everywhere, so nothing is written.
    const writesBeforeTrailing = writeCount();
    await pastThrottle();
    expect(writeCount()).toBe(writesBeforeTrailing);

    // And the queue is not wedged: this tab's next local edit still persists.
    tabA.state.value.push({ id: "a3" });
    await nextTick();
    await pastThrottle();
    expect(writeCount()).toBe(writesBeforeTrailing + 1);
    expect(environment.store.get(KEY)).toEqual([
      { id: "a1" },
      { id: "b1" },
      { id: "a3" },
    ]);
    expect(tabB.state.value).toEqual([
      { id: "a1" },
      { id: "b1" },
      { id: "a3" },
    ]);
  });

  it("keeps a held node reference stable across snapshots", async () => {
    const tab = usePersistentState<Item[]>(KEY, [{ id: "first" }]);
    await tab.hydrated;

    // Streaming holds on to the message it is appending to. Rebinding the tree
    // to a clone would detach it and the reply would stop rendering.
    const held = tab.state.value[0];
    tab.state.value.push({ id: "second" });
    await nextTick();
    await tick();

    expect(tab.state.value[0]).toBe(held);
    expect(writeCount()).toBe(1);
  });
});
