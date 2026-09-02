<script lang="ts">
	import { resolve } from '$app/paths';
	import logo from '$lib/assets/logo.svg';
</script>

<footer class="border-t border-line bg-sidebar text-white">
	<div class="mx-auto grid w-full max-w-7xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1fr_auto] md:items-end">
		<div>
			<a class="inline-flex items-center gap-3" href={resolve('/')} aria-label="Kiso CRM home">
				<img src={logo} alt="" class="size-9 rounded-xl" />
				<span class="text-lg font-bold tracking-[-0.035em]">Kiso CRM</span>
			</a>
			<p class="mt-4 max-w-md text-sm leading-6 text-white/65">
				The conversation-to-revenue workspace for focused home-service teams.
			</p>
		</div>
		<div class="flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-white/55">
			<a class="hover:text-white" href={resolve('/privacy')}>Privacy</a>
			<a class="hover:text-white" href={resolve('/terms')}>Terms</a>
			<a class="hover:text-white" href="mailto:support@kisocrm.com">Contact</a>
			<a class="hover:text-white" href={resolve('/signin')}>Sign in</a>
		</div>
	</div>
	<div class="border-t border-white/8">
		<div class="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 py-5 text-xs text-white/65 sm:flex-row sm:items-center sm:justify-between sm:px-8">
			<p>© {new Date().getFullYear()} Kiso CRM. All rights reserved.</p>
			<p>Built for the first five minutes of every lead.</p>
		</div>
	</div>
</footer>
