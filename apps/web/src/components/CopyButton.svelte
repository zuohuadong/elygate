<script lang="ts">
    import { Copy, Check } from "lucide-svelte";
    import { fade } from "svelte/transition";

    let { value, class: className = "" } = $props<{
        value: string;
        class?: string;
    }>();

    let copied = $state(false);
    let timeout: any;

    function handleCopy(e: MouseEvent) {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
            copied = true;
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                copied = false;
            }, 2000);
        });
    }
</script>

<button
    onclick={handleCopy}
    class="group/copy relative p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all active:scale-95 {className}"
    title="Copy to clipboard"
>
    {#if copied}
        <div in:fade={{ duration: 150 }}>
            <Check class="w-3.5 h-3.5" />
        </div>
        <div
            class="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-slate-900 dark:bg-slate-800 text-white text-[10px] rounded shadow-lg whitespace-nowrap"
            in:fade={{ y: 5, duration: 200 }}
            out:fade={{ duration: 150 }}
        >
            Copied!
        </div>
    {:else}
        <Copy class="w-3.5 h-3.5" />
    {/if}
</button>
