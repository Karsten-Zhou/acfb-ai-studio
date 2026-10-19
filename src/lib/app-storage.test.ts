// Persistence mirrors the app's mutable tree into a throttled IndexedDB
// snapshot, and `useIDBKeyval` broadcasts every write to other tabs. The pair
// worth pinning down is a remote update that lands while this tab still has a
// trailing snapshot queued: the queue must not re-publish the value it just
// received, and it must not lock out the tab's own next edit.
//
// Runs in the `node` test environment, so VueUse's browser detection and
// IndexedDB are stubbed: `defaultWindow` is captured while @vueuse/shared is
// evaluated, which is why the globals are installed in a hoisted block.
import { effectScope, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const { usePersistentState, storageIssue } = await import("@/lib/app-storage");

interface Item {
  id: string;
}

const KEY = "conversations:v3";

function writeCount(): number {
  return vi.mocked(update).mock.calls.length;
}

describe("usePersistentState", () => {
  // The throttle window is 300ms of wall clock, so "still inside the window"
  // and "past the trailing edge" are assertions rather than races only if the
  // test owns the clock. Hydration and Vue's scheduler are promise-based and
  // unaffected by faking it; the channel hand-off is a real macrotask, so those
  // steps advance a little at a time until it lands.
  let scope: ReturnType<typeof effectScope>;

  beforeEach(() => {
    environment.store.clear();
    vi.clearAllMocks();
    storageIssue.value = null;
    vi.useFakeTimers();
    scope = effectScope();
  });

  afterEach(() => {
    // The library registers its channel with `tryOnScopeDispose`, so stopping
    // the scope is what closes it; otherwise every test leaks its listeners
    // into the next one.
    scope.stop();
    vi.useRealTimers();
  });

  function inScope<T>(create: () => T): T {
    const created = scope.run(create);
    if (!created) throw new Error("effect scope stopped before use");
    return created;
  }

  async function advanceUntil(
    condition: () => boolean,
    label: string,
  ): Promise<void> {
    for (let step = 0; step < 8; step++) {
      if (condition()) return;
      await vi.advanceTimersByTimeAsync(25);
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  it("does not re-publish a remote update that arrives while a snapshot is queued", async () => {
    const tabA = inScope(() => usePersistentState<Item[]>(KEY, []));
    const tabB = inScope(() => usePersistentState<Item[]>(KEY, []));
    await Promise.all([tabA.hydrated, tabB.hydrated]);

    tabA.state.value.push({ id: "a1" });
    await nextTick();
    await advanceUntil(
      () => writeCount() === 1,
      "the first snapshot to persist",
    );
    await advanceUntil(
      () => tabB.state.value.length === 1,
      "tab B to adopt it",
    );

    expect(environment.store.get(KEY)).toEqual([{ id: "a1" }]);

    // Still inside the 300ms window, so this edit is only queued for later.
    tabA.state.value.push({ id: "a2" });
    await nextTick();
    expect(writeCount()).toBe(1);

    // The other tab writes, and this tab adopts that value while its own
    // queued snapshot is still pending.
    tabB.state.value.push({ id: "b1" });
    await nextTick();
    await advanceUntil(() => writeCount() === 2, "tab B's snapshot to persist");
    await advanceUntil(
      () => tabA.state.value.some((item) => item.id === "b1"),
      "tab A to adopt the remote value",
    );
    expect(tabA.state.value).toEqual([{ id: "a1" }, { id: "b1" }]);

    // Past the queued trailing edge: re-cloning the adopted value would write
    // and broadcast bytes that are already everywhere, so nothing is written.
    const writesBeforeTrailing = writeCount();
    await vi.advanceTimersByTimeAsync(500);
    expect(writeCount()).toBe(writesBeforeTrailing);

    // And the queue is not wedged: this tab's next local edit still persists,
    // carrying the change it adopted along with it.
    tabA.state.value.push({ id: "a3" });
    await nextTick();
    await advanceUntil(
      () => writeCount() === writesBeforeTrailing + 1,
      "a later local edit to persist",
    );
    expect(environment.store.get(KEY)).toEqual([
      { id: "a1" },
      { id: "b1" },
      { id: "a3" },
    ]);
    await advanceUntil(
      () => tabB.state.value.some((item) => item.id === "a3"),
      "tab B to adopt the third item",
    );
  });

  it("keeps a held node reference stable across snapshots", async () => {
    const tab = inScope(() =>
      usePersistentState<Item[]>(KEY, [{ id: "first" }]),
    );
    await tab.hydrated;

    // Streaming holds on to the message it is appending to. Rebinding the tree
    // to a clone would detach it and the reply would stop rendering.
    const held = tab.state.value[0];
    tab.state.value.push({ id: "second" });
    await nextTick();
    await advanceUntil(() => writeCount() === 1, "the snapshot to persist");

    expect(tab.state.value[0]).toBe(held);
  });

  it("reports a failed write instead of losing it silently", async () => {
    const tab = inScope(() => usePersistentState<Item[]>(KEY, []));
    await tab.hydrated;

    vi.mocked(update).mockRejectedValueOnce(new Error("quota exceeded"));
    tab.state.value.push({ id: "a1" });
    await nextTick();
    await advanceUntil(() => writeCount() === 1, "the write to be attempted");
    await advanceUntil(
      () => storageIssue.value !== null,
      "the warning to show",
    );

    expect(storageIssue.value).toBe("unavailable");
  });

  it("keeps edits unhandled when the snapshot cannot be cloned", async () => {
    const tab = inScope(() => usePersistentState<Item[]>(KEY, []));
    await tab.hydrated;

    // A value the structured clone algorithm refuses, so nothing can persist.
    tab.state.value.push(function notCloneable() {} as unknown as Item);
    await nextTick();
    await vi.advanceTimersByTimeAsync(500);
    await advanceUntil(
      () => storageIssue.value !== null,
      "the warning to show",
    );

    expect(storageIssue.value).toBe("unavailable");
    expect(writeCount()).toBe(0);

    // Once the value is cloneable, those edits are written rather than having
    // been recorded as stored while still in memory only.
    tab.state.value.splice(0, 1, { id: "serializable" });
    await nextTick();
    await vi.advanceTimersByTimeAsync(500);

    expect(writeCount()).toBe(1);
    expect(environment.store.get(KEY)).toEqual([{ id: "serializable" }]);
  });
});
