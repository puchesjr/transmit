<script lang="ts">
	let { children } = $props();
</script>

<div class="min-h-screen bg-canvas text-ink flex items-center justify-center px-4 py-12">
	<div class="w-full max-w-md">
		<div class="mb-8 flex items-center justify-center gap-2.5">
			<span
				class="flex size-9 items-center justify-center rounded-lg bg-accent text-base font-bold text-white"
			>
				T
			</span>
			<span class="text-lg font-semibold tracking-tight">Transmit</span>
		</div>
		{@render children()}
	</div>
</div>
