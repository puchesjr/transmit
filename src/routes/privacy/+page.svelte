<script lang="ts">
	import MarketingFooter from '$lib/client/MarketingFooter.svelte';
	import MarketingHeader from '$lib/client/MarketingHeader.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Privacy policy — Transmit</title>
	<meta name="description" content="How Transmit collects, uses, and protects information." />
	<link rel="canonical" href={`${data.siteUrl}/privacy`} />
</svelte:head>

<div class="min-h-dvh bg-canvas text-ink">
	<MarketingHeader signedIn={data.signedIn} compact />
	<main id="main-content" class="skip-target mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-24" tabindex="-1">
		<p class="section-title text-accent">Legal</p>
		<h1 class="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-6xl">Privacy policy</h1>
		<p class="mt-4 text-sm text-muted">Effective August 31, 2026</p>

		<div class="mt-12 space-y-10 text-[15px] leading-7 text-muted">
			<section>
				<h2 class="text-xl font-bold text-ink">What this policy covers</h2>
				<p class="mt-3">This policy explains how Transmit handles information when businesses use our website and customer communication service. A business using Transmit controls the customer information it places in the service; Transmit processes that information to provide the service.</p>
			</section>
			<section>
				<h2 class="text-xl font-bold text-ink">Information we collect</h2>
				<p class="mt-3">We collect account and workspace details, user names and email addresses, location information, customer contact records, message content, call event metadata, consent and opt-out status, lead details, product usage, support correspondence, and technical information such as IP address, browser type, and request identifiers.</p>
				<p class="mt-3">Payment details are collected and processed by Stripe. Transmit receives billing status, subscription identifiers, and limited payment metadata, but does not store full card numbers.</p>
			</section>
			<section>
				<h2 class="text-xl font-bold text-ink">How we use information</h2>
				<p class="mt-3">We use information to provide and secure the service, route calls and messages, maintain customer timelines, enforce messaging consent, process subscriptions, respond to support requests, diagnose problems, prevent abuse, and comply with law. We do not sell personal information.</p>
			</section>
			<section>
				<h2 class="text-xl font-bold text-ink">Providers and disclosures</h2>
				<p class="mt-3">We use service providers where necessary to operate Transmit, including Telnyx for phone and messaging services, Stripe for billing, and infrastructure providers for hosting and data storage. These providers process information under their own terms and privacy obligations. We may also disclose information when required by law, to protect people or the service, or as part of a business transaction with appropriate safeguards.</p>
			</section>
			<section>
				<h2 class="text-xl font-bold text-ink">Cookies and analytics</h2>
				<p class="mt-3">Transmit uses essential browser storage for sessions, security, theme preferences, and your analytics choice. Optional website analytics load only after you select “Allow analytics.” You can reset that choice by clearing this site's local storage.</p>
			</section>
			<section>
				<h2 class="text-xl font-bold text-ink">Retention and security</h2>
				<p class="mt-3">We retain information while an account is active and as reasonably necessary to provide the service, resolve disputes, maintain legitimate business records, and meet legal obligations. We use administrative and technical safeguards designed to protect information, but no system can guarantee absolute security.</p>
			</section>
			<section>
				<h2 class="text-xl font-bold text-ink">Your choices</h2>
				<p class="mt-3">Workspace administrators can update or delete many records in the product. Depending on where you live, you may also have rights to access, correct, delete, or receive a copy of personal information. Customers who received a message can reply STOP to opt out of further automated texts.</p>
			</section>
			<section>
				<h2 class="text-xl font-bold text-ink">Contact us</h2>
				<p class="mt-3">Questions or privacy requests can be sent to <a class="font-semibold text-ink underline underline-offset-4" href="mailto:privacy@transmit.dev">privacy@transmit.dev</a>. We may update this policy as the service changes and will post the updated effective date here.</p>
			</section>
		</div>
	</main>
	<MarketingFooter />
</div>
