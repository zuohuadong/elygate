<script lang="ts">
    import { Copy, Check } from "lucide-svelte";
    import { fade, fly } from "svelte/transition";

    let { value, class: className = "" } = $props<{
        value: string;
        class?: string;
    }>();

    let copied = $state(false);
    let timeout: any;

    function handleCopy(e: MouseEvent) {
        e.stopPropagation();
        
        const success = () => {
            copied = true;
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                copied = false;
            }, 2000);
        };

        try {
            const cb = (typeof navigator !== 'undefined' && navigator.clipboard);
            if (cb && typeof cb.writeText === 'function') {
                cb.writeText(value).then(success).catch(err => {
                    console.error("Clipboard API failed, trying fallback:", err);
                    fallbackCopy(value, success);
                });
            } else {
                fallbackCopy(value, success);
            }
        } catch (err) {
            console.error("Copy error, trying fallback:", err);
            fallbackCopy(value, success);
        }
    }

    function fallbackCopy(text: string, cb: () => void) {
        try {
            const textArea = document.createElement("textarea");
            textArea.value = text || "";
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            textArea.style.opacity = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            if (successful) cb();
        } catch (err) {
            console.error('Fallback copy failed:', err);
        }
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
            in:fly={{ y: 5, duration: 200 }}
            out:fade={{ duration: 150 }}
        >
            Copied!
        </div>
    {:else}
        <Copy class="w-3.5 h-3.5" />
    {/if}
</button>
