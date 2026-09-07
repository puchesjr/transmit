<script lang="ts">
 import { normalizeSms, smsMetrics } from '$lib/sms';
 const { body }: { body: string } = $props();
 let normalized = $derived(normalizeSms(body));
 let metrics = $derived(smsMetrics(normalized.text));
</script>
{#if body.trim()}
 <div class="mt-2 min-w-0 text-xs leading-5 text-muted" aria-live="polite">
  {#if normalized.unsupportedText}
   <p class="text-red-700 dark:text-red-300">Rewrite unsupported letters or numbers before sending. This SMS cannot be sent as written.</p>
  {:else if !normalized.text}
   <p class="text-red-700 dark:text-red-300">Add text after removing unsupported characters.</p>
  {:else}
   <p>{metrics.segments} SMS {metrics.segments === 1 ? 'segment' : 'segments'} · GSM-7 · {metrics.units} encoding units. One credit per segment; $0.02 per credit after the allowance.</p>
   {#if metrics.segments > 10}<p class="text-red-700 dark:text-red-300">Shorten to 10 segments or fewer.</p>{/if}
   {#if normalized.changed}
    <p>Smart punctuation, accents, and unsupported symbols will be adjusted. Text to send:</p>
    <p class="mt-1 whitespace-pre-wrap break-words rounded-lg border border-line p-2 text-ink">{normalized.text}</p>
   {/if}
  {/if}
 </div>
{/if}
