<script lang="ts">
	import logo from '$lib/assets/logo.svg';
	import ThemeToggle from '$lib/client/ThemeToggle.svelte';

	let { children } = $props();
</script>

<a class="skip-link" href="#main-content">Skip to main content</a>
<div class="grid min-h-dvh bg-paper text-ink lg:grid-cols-[minmax(0,1.08fr)_minmax(480px,0.92fr)]">
	<section class="relative hidden overflow-hidden bg-sidebar px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16 xl:py-12">
		<div class="absolute -top-52 -left-32 size-[560px] rounded-full bg-accent/25 blur-[110px]"></div>
		<div class="absolute -right-24 -bottom-64 size-[620px] rounded-full bg-brass/10 blur-[130px]"></div>
		<div class="relative flex items-center gap-3">
			<img src={logo} alt="" class="size-10 rounded-xl shadow-[0_10px_30px_rgba(178,58,31,0.3)]" />
			<span class="text-xl font-bold tracking-[-0.035em]">Kiso CRM</span>
		</div>

		<div class="relative max-w-xl pb-12">
			<div class="mb-6 flex items-center gap-2 text-xs font-bold tracking-[0.12em] text-accent-bright uppercase">
				<span class="h-px w-8 bg-accent-bright"></span>
				Messaging-native CRM
			</div>
			<h2 class="text-5xl leading-[1.05] font-bold tracking-[-0.055em] xl:text-6xl">
				Turn every conversation into momentum.
			</h2>
			<p class="mt-6 max-w-lg text-base leading-7 text-white/50">
				Keep contacts, deals, and two-way SMS in one focused workspace built for fast-moving teams.
			</p>
		</div>

		<p class="relative text-xs text-white/65">Focused CRM for multi-location teams</p>
	</section>

	<main id="main-content" class="skip-target relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas px-4 py-10 sm:px-8" tabindex="-1">
		<div class="absolute top-0 right-0 size-72 rounded-full bg-accent/[0.07] blur-3xl lg:hidden"></div>
		<div class="absolute top-4 right-4 z-10 sm:top-6 sm:right-6">
			<ThemeToggle />
		</div>
		<div class="relative w-full max-w-[440px]">
			<div class="mb-9 flex items-center gap-3 lg:hidden">
				<img src={logo} alt="" class="size-9 rounded-xl" />
				<span class="text-lg font-bold tracking-[-0.03em]">Kiso CRM</span>
			</div>
			{@render children()}
		</div>
	</main>
</div>
