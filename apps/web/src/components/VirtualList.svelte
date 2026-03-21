<script lang="ts" generics="T extends Record<string, unknown>">
    let {
        items = $bindable(),
        itemHeight = 48,
        containerHeight = 400,
        renderItem
    } = $props<{
        items: T[];
        itemHeight?: number;
        containerHeight?: number;
        renderItem: (item: T, index: number) => any;
    }>();

    let scrollTop = $state(0);
    let containerRef: HTMLDivElement | undefined = $state();

    const overscan = 5;

    function getTotalHeight(): number {
        return items.length * itemHeight;
    }

    function getStartIndex(): number {
        return Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    }

    function getEndIndex(): number {
        return Math.min(
            items.length - 1,
            Math.floor((scrollTop + containerHeight) / itemHeight) + overscan
        );
    }

    function getVisibleItems(): T[] {
        const start = getStartIndex();
        const end = getEndIndex();
        return items.slice(start, end + 1);
    }

    function handleScroll(e: Event) {
        const target = e.target as HTMLDivElement;
        scrollTop = target.scrollTop;
    }
</script>

<div
    bind:this={containerRef}
    class="overflow-y-auto"
    style="height: {containerHeight}px;"
    onscroll={handleScroll}
>
    <div style="height: {getTotalHeight()}px; position: relative;">
        {#each getVisibleItems() as item, i (getStartIndex() + i)}
            <div
                style="position: absolute; top: {(getStartIndex() + i) * itemHeight}px; width: 100%; height: {itemHeight}px;"
            >
                {@render renderItem(item, getStartIndex() + i)}
            </div>
        {/each}
    </div>
</div>
