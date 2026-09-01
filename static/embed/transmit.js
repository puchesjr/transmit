(() => {
	const script = document.currentScript;
	if (!(script instanceof HTMLScriptElement) || script.dataset.transmitLoaded === 'true') return;
	script.dataset.transmitLoaded = 'true';

	const origin = new URL(script.src).origin;
	const actions = [
		{ label: 'Text us', key: script.dataset.textKey, icon: '↗' },
		{ label: 'Request appointment', key: script.dataset.appointmentKey, icon: '◷' },
		{ label: 'Get a quote', key: script.dataset.quoteKey, icon: '$' }
	].filter((action) => action.key);
	if (actions.length === 0) return;

	const host = document.createElement('div');
	host.id = 'transmit-launcher';
	document.body.append(host);
	const root = host.attachShadow({ mode: 'open' });
	root.innerHTML = `
		<style>
			:host{all:initial;color-scheme:light dark;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
			*,*::before,*::after{box-sizing:border-box}
			.wrap{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:12px}
			.launcher{display:flex;min-width:56px;min-height:56px;align-items:center;justify-content:center;gap:9px;border:0;border-radius:18px;background:#bf4b0f;color:white;padding:0 18px;font:700 15px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 16px 42px rgba(81,31,7,.3);cursor:pointer}
			.launcher:hover{background:#a63c08;transform:translateY(-1px)}
			.launcher:focus-visible,.action:focus-visible,.close:focus-visible{outline:3px solid #ff9148;outline-offset:3px}
			.bolt{font-size:19px;line-height:1}
			.panel{display:none;width:min(360px,calc(100vw - 28px));overflow:hidden;border:1px solid rgba(15,23,42,.14);border-radius:22px;background:#fff;color:#202632;box-shadow:0 24px 70px rgba(15,23,42,.24)}
			.panel.open{display:block}
			.head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 20px 16px}
			.eyebrow{margin:0;color:#a63c08;font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}
			h2{margin:5px 0 0;font-size:20px;line-height:1.2;letter-spacing:-.025em}
			.close{display:flex;width:40px;height:40px;flex:0 0 auto;align-items:center;justify-content:center;border:0;border-radius:12px;background:#f2f3f5;color:#202632;font:500 24px/1 sans-serif;cursor:pointer}
			.actions{display:grid;gap:8px;padding:0 12px 12px}
			.action{display:flex;min-height:54px;align-items:center;gap:12px;width:100%;border:1px solid #e1e4e8;border-radius:14px;background:#fff;color:#202632;padding:10px 12px;text-align:left;font:700 14px/1.3 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
			.action:hover{border-color:#d36327;background:#fff8f3}
			.icon{display:flex;width:34px;height:34px;align-items:center;justify-content:center;border-radius:10px;background:#fff0e7;color:#a63c08;font-weight:900}
			.arrow{margin-left:auto;color:#737984}
			.frame-wrap{display:none;border-top:1px solid #e1e4e8}
			.frame-wrap.open{display:block}
			iframe{display:block;width:100%;height:min(660px,calc(100vh - 130px));border:0;background:#faf8f5}
			@media(max-width:480px){.wrap{right:14px;bottom:max(14px,env(safe-area-inset-bottom))}.panel{width:calc(100vw - 28px);max-height:calc(100vh - 90px)}.launcher .label{display:none}.launcher{width:56px;padding:0}.head{padding:17px 17px 14px}}
			@media(prefers-color-scheme:dark){.panel{border-color:#3b414b;background:#252a32;color:#f3f1ed}.close{background:#343a44;color:#f3f1ed}.action{border-color:#3b414b;background:#252a32;color:#f3f1ed}.action:hover{border-color:#ff9148;background:#30271f}.icon{background:#3b281d;color:#ffad76}.arrow{color:#aeb4bd}.frame-wrap{border-color:#3b414b}iframe{background:#191d23}.eyebrow{color:#ff9148}}
			@media(prefers-reduced-motion:no-preference){.launcher,.action{transition:background-color .15s,border-color .15s,transform .15s}.panel.open{animation:enter .18s ease-out}@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
		</style>
		<div class="wrap">
			<section class="panel" role="dialog" aria-modal="false" aria-labelledby="transmit-title">
				<div class="head">
					<div><p class="eyebrow">Fast response</p><h2 id="transmit-title">How can we help?</h2></div>
					<button class="close" type="button" aria-label="Close contact options">×</button>
				</div>
				<div class="actions"></div>
				<div class="frame-wrap"><iframe title="Contact request form"></iframe></div>
			</section>
			<button class="launcher" type="button" aria-expanded="false"><span class="bolt" aria-hidden="true">✦</span><span class="label">Contact us</span></button>
		</div>`;

	const panel = root.querySelector('.panel');
	const launcher = root.querySelector('.launcher');
	const close = root.querySelector('.close');
	const actionList = root.querySelector('.actions');
	const frameWrap = root.querySelector('.frame-wrap');
	const frame = root.querySelector('iframe');
	const title = root.querySelector('h2');

	const closePanel = () => {
		panel.classList.remove('open');
		launcher.setAttribute('aria-expanded', 'false');
		launcher.focus();
	};
	launcher.addEventListener('click', () => {
		const open = panel.classList.toggle('open');
		launcher.setAttribute('aria-expanded', String(open));
		if (open) close.focus();
	});
	close.addEventListener('click', closePanel);
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && panel.classList.contains('open')) closePanel();
	});

	for (const action of actions) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'action';
		button.innerHTML = `<span class="icon" aria-hidden="true">${action.icon}</span><span>${action.label}</span><span class="arrow" aria-hidden="true">→</span>`;
		button.addEventListener('click', () => {
			const parentUrl = new URL(window.location.href);
			const captureUrl = new URL(`/capture/${encodeURIComponent(action.key)}`, origin);
			captureUrl.searchParams.set('embed', '1');
			captureUrl.searchParams.set('source_page', parentUrl.href);
			if (document.referrer) captureUrl.searchParams.set('referrer', document.referrer);
			for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
				const value = parentUrl.searchParams.get(key);
				if (value) captureUrl.searchParams.set(key, value);
			}
			frame.src = captureUrl.href;
			frame.title = action.label;
			title.textContent = action.label;
			actionList.style.display = 'none';
			frameWrap.classList.add('open');
		});
		actionList.append(button);
	}
})();
