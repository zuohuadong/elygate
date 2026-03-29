<script lang="ts">
  /**
   * VirtualTable — A lightweight virtual scrolling wrapper for large datasets.
   * Uses IntersectionObserver-based approach instead of a heavy dependency.
   *
   * Usage:
   *   <VirtualTable items={rows} rowHeight={40} containerHeight={500}>
   *     {#snippet row(item, index)}
   *       <tr>...</tr>
   *     {/snippet}
   *   </VirtualTable>
   */
  import type { Snippet } from 'svelte';

  interface Props<T> {
    items: T[];
    /** Estimated row height in pixels */
    rowHeight?: number;
    /** Container height in pixels */
    containerHeight?: number;
    /** Number of extra rows to render above/below visible area */
    overscan?: number;
    /** Row rendering snippet */
    row: Snippet<[T, number]>;
    class?: string;
  }

  let {
    items,
    rowHeight = 40,
    containerHeight = 500,
    overscan = 5,
    row,
    class: className = '',
  }: Props<unknown> = $props();

  let scrollTop = $state(0);
  let containerRef = $state<HTMLDivElement | null>(null);

  const totalHeight = $derived(items.length * rowHeight);

  const visibleRange = $derived.by(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / rowHeight);
    const end = Math.min(items.length - 1, start + visibleCount + overscan * 2);
    return { start, end };
  });

  const visibleItems = $derived(
    items.slice(visibleRange.start, visibleRange.end + 1).map((item, i) => ({
      item,
      index: visibleRange.start + i,
      offsetY: (visibleRange.start + i) * rowHeight,
    }))
  );

  function handleScroll(e: Event) {
    const target = e.target as HTMLDivElement;
    scrollTop = target.scrollTop;
  }
</script>

<div
  bind:this={containerRef}
  class="overflow-auto {className}"
  style="height: {containerHeight}px;"
  onscroll={handleScroll}
>
  <div style="position: relative; height: {totalHeight}px; width: 100%;">
    {#each visibleItems as { item, index, offsetY } (index)}
      <div style="position: absolute; top: {offsetY}px; left: 0; right: 0; height: {rowHeight}px;">
        {@render row(item, index)}
      </div>
    {/each}
  </div>
</div>
