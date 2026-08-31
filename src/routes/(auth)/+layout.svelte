<script lang="ts">
	let { children } = $props();
</script>

<div class="min-h-screen bg-canvas text-ink flex items-center justify-center px-4 py-12">
	<div class="w-full max-w-md">
		<p class="mb-8 text-center text-xs font-semibold tracking-[0.28em] uppercase text-muted">
			Transmit
		</p>
		{@render children()}
	</div>
</div>
