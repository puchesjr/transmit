<script lang="ts">
	import MarketingFooter from '$lib/client/MarketingFooter.svelte';
	import MarketingHeader from '$lib/client/MarketingHeader.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Terms of service — Transmit</title>
	<meta name="description" content="The terms that govern use of Transmit." />
	<link rel="canonical" href={`${data.siteUrl}/terms`} />
</svelte:head>

<div class="min-h-dvh bg-canvas text-ink">
	<MarketingHeader signedIn={data.signedIn} compact />
	<main id="main-content" class="skip-target mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 sm:py-24" tabindex="-1">
		<p class="section-title text-accent">Legal</p>
		<h1 class="mt-4 text-4xl font-bold tracking-[-0.05em] sm:text-6xl">Terms of service</h1>
		<p class="mt-4 text-sm text-muted">Effective August 31, 2026</p>

		<div class="mt-12 space-y-10 text-[15px] leading-7 text-muted">
			<section><h2 class="text-xl font-bold text-ink">Agreement</h2><p class="mt-3">These terms govern your access to Transmit. By creating an account or using the service, you agree to these terms on behalf of yourself and, if applicable, your business. You must be able to form a binding contract and provide accurate account information.</p></section>
			<section><h2 class="text-xl font-bold text-ink">The service</h2><p class="mt-3">Transmit provides business messaging, missed-call textback, customer records, lead tracking, and related account tools. Features may change as the product develops. Transmit is not an emergency service, telephone carrier, dispatch system, or system of record for accounting or regulatory compliance.</p></section>
			<section><h2 class="text-xl font-bold text-ink">Your responsibilities</h2><p class="mt-3">You are responsible for your users, customer data, message content, and use of the service. You must obtain and document legally sufficient consent before sending messages; identify your business where required; honor opt-out requests; maintain accurate 10DLC registration details; and comply with telecommunications, privacy, marketing, and consumer protection laws that apply to you.</p></section>
			<section><h2 class="text-xl font-bold text-ink">Acceptable use</h2><p class="mt-3">Do not use Transmit for unlawful, deceptive, abusive, harassing, fraudulent, or unsolicited communications; to send prohibited content; to impersonate others; to interfere with the service; or to attempt unauthorized access. We may suspend traffic or accounts when necessary to protect recipients, providers, or the service.</p></section>
			<section><h2 class="text-xl font-bold text-ink">Trial, fees, and cancellation</h2><p class="mt-3">A valid payment method is required to provision a number. Unless you cancel before the stated trial ends, the subscription automatically begins at the price shown when you subscribe, plus usage charges and applicable taxes. Fees are billed through Stripe. You may cancel through the billing portal; cancellation takes effect at the end of the current paid period unless law requires otherwise.</p></section>
			<section><h2 class="text-xl font-bold text-ink">Customer data</h2><p class="mt-3">You retain ownership of the data you submit. You grant Transmit the rights needed to host, process, transmit, and display that data to operate and improve the service. You represent that you have the rights and permissions required to provide the data to us.</p></section>
			<section><h2 class="text-xl font-bold text-ink">Service availability</h2><p class="mt-3">We work to keep Transmit available and secure, but the service is provided on an “as is” and “as available” basis to the extent permitted by law. Carrier networks, registration reviews, and third-party services can delay or prevent calls, messages, and billing operations.</p></section>
			<section><h2 class="text-xl font-bold text-ink">Liability</h2><p class="mt-3">To the maximum extent permitted by law, Transmit is not liable for indirect, incidental, special, consequential, exemplary, or lost-profit damages. Our total liability for claims related to the service will not exceed the amount you paid Transmit in the three months before the event giving rise to the claim. Some jurisdictions do not allow all limitations, so these limits apply only where lawful.</p></section>
			<section><h2 class="text-xl font-bold text-ink">Termination and changes</h2><p class="mt-3">You may stop using the service at any time. We may suspend or terminate access for material breach, unlawful use, nonpayment, security risk, or harm to others. We may update these terms and will post the new effective date. Material changes will apply prospectively.</p></section>
			<section><h2 class="text-xl font-bold text-ink">Contact</h2><p class="mt-3">Questions about these terms can be sent to <a class="font-semibold text-ink underline underline-offset-4" href="mailto:support@transmit.dev">support@transmit.dev</a>.</p></section>
		</div>
	</main>
	<MarketingFooter />
</div>
