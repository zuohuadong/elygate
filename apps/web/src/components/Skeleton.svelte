<script lang="ts">
    let { 
        width = '100%',
        height = '1rem',
        rounded = 'md',
        class: className = ''
    } = $props();

    const roundedClasses: Record<string, string> = {
        'none': 'rounded-none',
        'sm': 'rounded-sm',
        'md': 'rounded-md',
        'lg': 'rounded-lg',
        'xl': 'rounded-xl',
        'full': 'rounded-full'
    };
</script>

<div 
    class="animate-pulse bg-slate-200 dark:bg-slate-800 {roundedClasses[rounded] || 'rounded-md'} {className}"
    style="width: {width}; height: {height};"
></div>
