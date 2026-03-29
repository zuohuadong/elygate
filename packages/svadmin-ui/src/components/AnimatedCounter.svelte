<script lang="ts">
  import { untrack } from 'svelte';

  interface Props {
    /** The target number to animate to */
    value: number | string;
    /** Animation duration in milliseconds */
    duration?: number;
    /** CSS class for the container */
    class?: string;
  }

  let { value, duration = 600, class: className = '' }: Props = $props();

  let displayValue = $state('0');
  let prevTarget = 0;

  $effect(() => {
    const target = typeof value === 'number' ? value : parseInt(value, 10);
    if (isNaN(target)) {
      displayValue = String(value);
      return;
    }

    const start = untrack(() => prevTarget);
    prevTarget = target;
    const startTime = performance.now();

    function tick() {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (target - start) * eased);
      displayValue = current.toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  });
</script>

<span class={className}>{displayValue}</span>
