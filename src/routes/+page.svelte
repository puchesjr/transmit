<script lang="ts">
	import { resolve } from '$app/paths';
	import AnalyticsConsent from '$lib/client/AnalyticsConsent.svelte';
	import MarketingFooter from '$lib/client/MarketingFooter.svelte';
	import MarketingHeader from '$lib/client/MarketingHeader.svelte';
	import { LAUNCH_PRICE } from '$lib/pricing';

	let { data } = $props();

	const primaryHref = $derived(resolve(data.signedIn ? '/inbox' : '/signup'));
	const primaryLabel = $derived(data.signedIn ? 'Open your inbox' : 'Start your 14-day trial');
	const steps = [
		{
			number: '01',
			title: 'A customer reaches out',
			body: 'A missed call or focused website request lands against the right location.'
		},
		{
			number: '02',
			title: 'Kiso CRM responds',
			body: 'A compliant text goes out immediately, while intent is still high.'
		},
		{
			number: '03',
			title: 'AI helps you reply',
			body: 'Your team gets three context-aware drafts, then chooses, edits, and sends the right response.'
		},
		{
			number: '04',
			title: 'The lead moves forward',
			body: 'Capture the job value and move the opportunity through a focused pipeline.'
		}
	];
	const features = [
		{
			title: 'One shared inbox',
			body: 'Read and reply to customer texts as a team, with unread state and a complete timeline.'
		},
		{
			title: 'Missed-call textback',
			body: 'Automatically acknowledge missed callers so the next conversation starts immediately.'
		},
		{
			title: 'AI response coach',
			body: 'Generate fast, warm, and qualifying reply options from the real conversation—never an automatic send.'
		},
		{
			title: 'Website lead capture',
			body: 'Turn service, quote, appointment, and question requests into an immediate text conversation.'
		},
		{
			title: 'Consent-aware messaging',
			body: 'STOP and HELP handling, quiet-hour deferral, and 10DLC registration are part of the workflow.'
		},
		{
			title: 'Follow-up drafts',
			body: 'Bring idle leads back to the team with a prepared nudge that stays queued for owner review.'
		}
	];
	const faqs = [
		{
			question: 'Who is Kiso CRM for?',
			answer:
				'Kiso CRM is for focused home-service teams that depend on phone calls and texts to win new work, especially teams that need a simpler front desk rather than a full field-service suite.'
		},
		{
			question: 'Does Kiso CRM replace ServiceTitan or my scheduling software?',
			answer:
				'No. Kiso CRM owns the first five minutes: missed calls, text conversations, customer context, and lead follow-through. Keep the scheduling, dispatch, and accounting systems that already run your operation.'
		},
		{
			question: 'Do I get a business phone number?',
			answer:
				'Yes. Each active location can provision a dedicated messaging number after its registration is approved.'
		},
		{
			question: 'How does messaging compliance work?',
			answer:
				'Kiso CRM includes 10DLC registration, STOP and HELP handling, consent checks before outbound messages, and quiet-hour deferral. Your business still needs to collect valid consent and use messaging lawfully.'
		},
		{
			question: 'What happens during the trial?',
			answer: `The trial lasts ${LAUNCH_PRICE.trialDays} days and includes up to ${LAUNCH_PRICE.trialOutboundMessages} outbound messages. A card is required before a phone number is provisioned, and billing begins only after the trial unless you cancel.`
		},
		{
			question: 'Does Kiso CRM use AI to answer customers?',
			answer:
				'Yes—with a human in control. Kiso CRM drafts three reply options, summarizes conversations, detects intent and urgency, and prepares idle-lead follow-ups. Your team chooses, edits, and sends every customer message. AI never sends automatically.'
		},
		{
			question: 'Can customers request appointments from my website?',
			answer:
				'Yes. The website launcher and hosted forms capture the requested service and preferred time, create the customer and lead, and start a text conversation immediately. Kiso CRM does not invent availability or claim the appointment is booked—a person confirms the time by text.'
		}
	];
</script>

<svelte:head>
	<title>Kiso CRM — Turn missed calls into booked work</title>
	<meta name="description" content="The AI-assisted inbox for home-service teams: capture website leads, respond faster, and turn missed calls into booked work." />
	<link rel="canonical" href={`${data.siteUrl}/`} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Kiso CRM" />
	<meta property="og:title" content="Turn missed calls into booked work." />
	<meta property="og:description" content="Website lead capture, human-reviewed AI replies, two-way SMS, and missed-call textback for home-service teams." />
	<meta property="og:url" content={`${data.siteUrl}/`} />
	<meta property="og:image" content={`${data.siteUrl}/og.png`} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="Kiso CRM — Turn missed calls into booked work." />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Turn missed calls into booked work." />
	<meta name="twitter:description" content="Website lead capture, human-reviewed AI replies, two-way SMS, and missed-call textback for home-service teams." />
	<meta name="twitter:image" content={`${data.siteUrl}/og.png`} />
</svelte:head>

<div class="min-h-dvh overflow-hidden bg-canvas text-ink">
	<MarketingHeader signedIn={data.signedIn} />

	<main id="main-content" class="skip-target" tabindex="-1">
		<section class="relative mx-auto grid w-full max-w-7xl items-center gap-10 px-4 py-10 sm:gap-14 sm:px-8 sm:py-14 lg:min-h-[calc(100dvh-5rem)] lg:grid-cols-[0.88fr_1.12fr] lg:py-20">
			<div class="pointer-events-none absolute top-0 -left-48 size-[520px] rounded-full bg-accent/10 blur-[130px]"></div>
			<div class="relative z-10 max-w-2xl">
				<p class="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-paper/80 px-3 py-1.5 text-xs font-bold tracking-[0.08em] text-action uppercase dark:text-accent"><span class="size-1.5 rounded-full bg-action dark:bg-accent"></span>AI-assisted · human-sent</p>
				<h1 class="text-[clamp(2.75rem,12vw,4rem)] leading-[0.94] font-bold tracking-[-0.065em] text-balance sm:text-[clamp(3.75rem,7vw,6.4rem)]">Turn missed calls into <span class="text-accent">booked work.</span></h1>
				<p class="mt-6 max-w-xl text-base leading-7 text-muted sm:mt-7 sm:text-lg sm:leading-8">Respond while intent is high. Kiso CRM combines website lead capture, missed-call textback, a shared inbox, and human-reviewed AI drafts so your team communicates better and moves every real lead forward.</p>
				<div class="mt-8 flex flex-col gap-3 sm:flex-row">
					<a class="btn min-h-12 px-6" href={primaryHref}>{primaryLabel}</a>
					<a class="btn-secondary min-h-12 px-6" href="#workflow">See how it works</a>
				</div>
				<p class="mt-4 text-xs text-muted">Card required · {LAUNCH_PRICE.trialOutboundMessages} outbound trial messages · Setup takes minutes</p>
			</div>

			<div class="relative z-10 min-w-0 lg:pl-6">
				<div class="rounded-[2rem] border border-line bg-sidebar p-3 shadow-[0_35px_100px_rgba(15,23,42,0.2)] sm:p-4">
					<div class="overflow-hidden rounded-[1.35rem] border border-white/8 bg-paper">
						<div class="flex items-center justify-between border-b border-line bg-canvas/80 px-4 py-3 sm:px-5">
							<div><p class="text-sm font-bold">Inbox</p><p class="text-[10px] text-muted">Northstar Home Services · Main</p></div>
							<span class="badge bg-accent/10 text-accent">3 open</span>
						</div>
						<div class="grid min-h-[340px] sm:min-h-[420px] sm:grid-cols-[0.78fr_1.22fr]">
							<div class="hidden border-r border-line p-3 sm:block">
								<p class="px-2 pb-2 text-[10px] font-bold tracking-widest text-muted uppercase">Needs a reply</p>
								<div class="rounded-xl bg-accent/10 p-3"><div class="flex items-center justify-between"><p class="text-sm font-semibold">Jamie Reed</p><span class="size-2 rounded-full bg-accent"></span></div><p class="mt-1 truncate text-xs text-muted">Can you come by this afternoon?</p></div>
								<div class="mt-1 rounded-xl p-3"><p class="text-sm font-semibold">Morgan Lee</p><p class="mt-1 truncate text-xs text-muted">Our AC stopped cooling.</p></div>
							</div>
							<div class="flex flex-col p-4 sm:p-5">
								<div class="flex items-center justify-between border-b border-line pb-4"><div><p class="font-semibold">Jamie Reed</p><p class="text-xs text-muted">New service request · Austin</p></div><span class="badge">Qualified</span></div>
								<div class="flex flex-1 flex-col justify-end gap-3 py-5"><p class="message-in">Sorry we missed your call — how can we help?</p><p class="message-in">Our kitchen sink is backing up. Can you come today?</p><p class="message-out">Thanks for reaching out—we can help. What is the service address?</p></div>
								<div class="rounded-xl border border-accent/25 bg-accent/[0.055] px-4 py-3"><p class="text-[10px] font-bold tracking-wider text-accent uppercase">✦ AI response coach</p><p class="mt-1 text-xs font-semibold">3 drafts ready · human approval required</p></div>
							</div>
						</div>
					</div>
				</div>
				<div class="absolute -right-5 -bottom-6 hidden rounded-2xl border border-line bg-paper p-4 shadow-xl sm:block"><p class="text-[10px] font-bold tracking-wider text-muted uppercase">Speed to lead</p><p class="mt-1 text-base font-bold">Needs a reply now</p><p class="text-xs text-muted">clear ownership · shared context</p></div>
			</div>
		</section>

		<section class="border-y border-line bg-paper px-4 sm:px-8" aria-label="Why Kiso CRM">
			<ul class="mx-auto grid w-full max-w-7xl sm:grid-cols-3" aria-label="Why Kiso CRM">
				<li class="py-6 sm:py-7 sm:pr-8"><span class="mb-3 block h-1 w-8 rounded-full bg-accent/70" aria-hidden="true"></span><p class="text-sm font-bold">The first five minutes matter.</p><p class="mt-1 text-xs leading-5 text-muted">Reach the caller while the job is still yours to win.</p></li>
				<li class="border-t border-line py-6 sm:border-t-0 sm:border-l sm:px-8 sm:py-7"><span class="mb-3 block h-1 w-8 rounded-full bg-accent/70" aria-hidden="true"></span><p class="text-sm font-bold">One accountable inbox.</p><p class="mt-1 text-xs leading-5 text-muted">Every customer, reply, and unread message in one place.</p></li>
				<li class="border-t border-line py-6 sm:border-t-0 sm:border-l sm:py-7 sm:pl-8"><span class="mb-3 block h-1 w-8 rounded-full bg-accent/70" aria-hidden="true"></span><p class="text-sm font-bold">AI that keeps humans in control.</p><p class="mt-1 text-xs leading-5 text-muted">Useful drafts and clear next steps; your team always decides what gets sent.</p></li>
			</ul>
		</section>

		<section id="workflow" class="scroll-mt-20 px-4 py-20 sm:px-8 sm:py-24 lg:py-32">
			<div class="mx-auto w-full max-w-7xl">
				<div class="max-w-2xl"><p class="section-title text-accent">How it works</p><h2 class="mt-4 text-3xl leading-tight font-bold tracking-[-0.05em] sm:text-5xl lg:text-6xl">One new lead. Four calm steps.</h2><p class="mt-5 text-base leading-7 text-muted sm:text-lg sm:leading-8">Kiso CRM connects website and phone intent to a text conversation, customer record, and revenue opportunity without adding another operational maze.</p></div>
				<ol class="mt-10 grid gap-3 sm:mt-14 sm:gap-4 md:grid-cols-2 lg:grid-cols-4">
					{#each steps as step}
						<li class="card relative overflow-hidden p-5 sm:min-h-56 sm:p-6 lg:min-h-64"><p class="text-4xl font-bold tracking-[-0.07em] text-accent/75 sm:text-5xl lg:text-6xl">{step.number}</p><h3 class="mt-5 text-lg font-bold tracking-[-0.02em] sm:mt-7 lg:mt-8">{step.title}</h3><p class="mt-2.5 text-sm leading-6 text-muted sm:mt-3">{step.body}</p></li>
					{/each}
				</ol>
			</div>
		</section>

		<section id="product" class="scroll-mt-20 bg-sidebar px-4 py-20 text-white sm:px-8 sm:py-24 lg:py-32">
			<div class="mx-auto w-full max-w-7xl">
				<div class="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
					<div class="max-w-3xl"><p class="text-[11px] font-bold tracking-[0.1em] text-accent-bright uppercase">The product</p><h2 class="mt-4 text-3xl leading-tight font-bold tracking-[-0.05em] sm:text-5xl lg:text-6xl">The inbox is the product. AI makes it faster.</h2><p class="mt-5 max-w-2xl text-base leading-7 text-white/65 sm:text-lg sm:leading-8">Kiso CRM begins with the customer conversation, surfaces intent and urgency, and gives your team clear reply choices and next steps—without taking the send button away from them.</p></div>
					<a class="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 px-5 text-sm font-semibold text-white transition hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href={primaryHref}>See it with your team</a>
				</div>
				<figure class="mt-10 overflow-hidden rounded-[1.35rem] border border-white/10 bg-white/[0.03] p-1.5 shadow-[0_40px_100px_rgba(0,0,0,0.4)] sm:mt-14 sm:rounded-[1.75rem] sm:p-3"><img src="/images/product-inbox.jpg" alt="Kiso CRM shared inbox showing a real two-way customer text conversation" width="1440" height="900" loading="lazy" decoding="async" sizes="(min-width: 1280px) 1280px, calc(100vw - 2rem)" class="block h-auto w-full rounded-[0.95rem] sm:rounded-[1.15rem]" /></figure>
				<div class="mt-4 grid gap-4 sm:mt-6 sm:gap-6 lg:grid-cols-2">
					<figure class="overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-1.5 sm:rounded-[1.5rem] sm:p-2"><img src="/images/product-leads.jpg" alt="Kiso CRM lead pipeline with open and closed opportunities" width="1440" height="900" loading="lazy" decoding="async" sizes="(min-width: 1024px) 624px, calc(100vw - 2rem)" class="block h-auto w-full rounded-[0.9rem] sm:rounded-[1rem]" /><figcaption class="px-3 py-3 text-sm leading-6 text-white/65 sm:px-4 sm:py-4"><strong class="text-white">A focused pipeline.</strong> Keep job value and stage visible without configuring an enterprise CRM.</figcaption></figure>
					<figure class="overflow-hidden rounded-[1.25rem] border border-white/10 bg-white/[0.03] p-1.5 sm:rounded-[1.5rem] sm:p-2"><img src="/images/product-billing.jpg" alt="Kiso CRM billing page with trial and usage details" width="1440" height="900" loading="lazy" decoding="async" sizes="(min-width: 1024px) 624px, calc(100vw - 2rem)" class="block h-auto w-full rounded-[0.9rem] sm:rounded-[1rem]" /><figcaption class="px-3 py-3 text-sm leading-6 text-white/65 sm:px-4 sm:py-4"><strong class="text-white">No billing mystery.</strong> See trial status, locations, and message usage where your team works.</figcaption></figure>
				</div>
			</div>
		</section>

		<section class="px-4 py-20 sm:px-8 sm:py-24 lg:py-32">
			<div class="mx-auto w-full max-w-7xl">
				<div class="max-w-2xl"><p class="section-title text-accent">What ships today</p><h2 class="mt-4 text-3xl leading-tight font-bold tracking-[-0.05em] sm:text-5xl">Enough system to win the work. Nothing to babysit.</h2></div>
				<div class="mt-10 grid border-t border-l border-line sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
					{#each features as feature}
						<article class="border-r border-b border-line bg-paper p-5 sm:p-8"><span class="mb-6 flex size-9 items-center justify-center rounded-xl bg-accent/10 text-accent sm:mb-8" aria-hidden="true">●</span><h3 class="text-lg font-bold tracking-[-0.02em]">{feature.title}</h3><p class="mt-3 text-sm leading-6 text-muted">{feature.body}</p></article>
					{/each}
				</div>
			</div>
		</section>

		<section id="pricing" class="scroll-mt-20 border-y border-line bg-paper px-4 py-20 sm:px-8 sm:py-24 lg:py-32">
			<div class="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-[0.85fr_1.15fr]">
				<div><p class="section-title text-accent">One honest price</p><h2 class="mt-4 text-3xl leading-tight font-bold tracking-[-0.05em] sm:text-5xl lg:text-6xl">Know what the next customer costs.</h2><p class="mt-5 max-w-lg text-base leading-7 text-muted sm:text-lg sm:leading-8">No seat math. No feature maze. Start with one location, then add another when the business does.</p></div>
				<div class="relative overflow-hidden rounded-[2rem] bg-sidebar p-7 text-white shadow-[0_30px_80px_rgba(15,23,42,0.22)] sm:p-10">
					<div class="pointer-events-none absolute -top-32 -right-24 size-72 rounded-full bg-accent/25 blur-3xl"></div>
					<div class="relative">
						<div class="flex flex-col gap-4 border-b border-white/10 pb-8 sm:flex-row sm:items-end sm:justify-between"><div><p class="text-sm font-bold text-accent-bright">Kiso CRM</p><p class="mt-2 text-5xl font-bold tracking-[-0.06em]">${LAUNCH_PRICE.locationMonthlyDollars}<span class="text-base font-medium tracking-normal text-white/65"> / location / month</span></p></div><p class="text-sm text-white/65">+ ${LAUNCH_PRICE.messageDollars.toFixed(2)} per sent or received message</p></div>
						<ul class="grid gap-3 py-8 text-sm sm:grid-cols-2"><li>✓ Shared team inbox</li><li>✓ Website lead capture</li><li>✓ Human-reviewed AI replies</li><li>✓ Conversation briefs</li><li>✓ Missed-call textback</li><li>✓ Compliance controls</li></ul>
						<a class="btn min-h-12 w-full px-6" href={primaryHref}>{primaryLabel}</a>
						<p class="mt-4 text-center text-xs text-white/65">{LAUNCH_PRICE.trialDays}-day trial · Card required · Cancel before renewal</p>
					</div>
				</div>
			</div>
		</section>

		<section id="faq" class="scroll-mt-20 px-4 py-20 sm:px-8 sm:py-24 lg:py-32">
			<div class="mx-auto grid w-full max-w-6xl gap-12 lg:grid-cols-[0.6fr_1.4fr]">
				<div><p class="section-title text-accent">Questions, answered</p><h2 class="mt-4 text-3xl font-bold tracking-[-0.05em] sm:text-4xl">Before you hand us the phone.</h2></div>
				<div class="divide-y divide-line border-y border-line">
					{#each faqs as faq}
						<details class="group py-5"><summary class="flex cursor-pointer list-none items-center justify-between gap-5 text-left font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">{faq.question}<span class="text-xl font-normal text-accent transition group-open:rotate-45" aria-hidden="true">+</span></summary><p class="max-w-2xl pt-4 pr-10 text-sm leading-7 text-muted">{faq.answer}</p></details>
					{/each}
				</div>
			</div>
		</section>

		<section class="px-4 pb-20 sm:px-8 sm:pb-24 lg:pb-32">
			<div class="relative mx-auto w-full max-w-7xl overflow-hidden rounded-[2rem] bg-action px-6 py-16 text-center text-white sm:px-12 sm:py-20">
				<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.24),transparent_38%)]"></div>
				<div class="relative mx-auto max-w-3xl"><p class="text-xs font-bold tracking-[0.12em] uppercase">The next lead is already calling</p><h2 class="mt-4 text-4xl leading-tight font-bold tracking-[-0.055em] sm:text-6xl">Make sure somebody answers—even when nobody does.</h2><p class="mx-auto mt-5 max-w-xl text-base leading-7 text-white/80">Start with your first location and put every customer conversation in one accountable place.</p><a class="mt-8 inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-6 text-sm font-bold text-action shadow-xl transition hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" href={primaryHref}>{primaryLabel}</a></div>
			</div>
		</section>
	</main>

	<MarketingFooter />
	<AnalyticsConsent scriptUrl={data.analytics.scriptUrl} siteId={data.analytics.siteId} />
</div>
