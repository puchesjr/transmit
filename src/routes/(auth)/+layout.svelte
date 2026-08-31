<script lang="ts">
	import logo from '$lib/assets/logo.svg';

	let { children } = $props();
</script>

<div class="min-h-screen bg-canvas text-ink flex items-center justify-center px-4 py-12">
	<div class="w-full max-w-md">
		<div class="mb-8 flex items-center justify-center gap-2.5">
			<img src={logo} alt="" class="size-9 rounded-lg" />
			<span class="text-lg font-semibold tracking-tight">Transmit</span>
		</div>
		{@render children()}
	</div>
</div>
