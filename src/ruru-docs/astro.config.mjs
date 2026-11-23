// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Served from GitHub Pages at https://kerwincarpede.github.io/ruru/, so every
// link inside the site starts with the /ruru base.
const section = (label, directory) => ({ label, items: [{ autogenerate: { directory } }] });

export default defineConfig({
	site: 'https://kerwincarpede.github.io',
	base: '/ruru',
	integrations: [
		starlight({
			title: 'Ruru',
			description: 'Eyes on every camera. A fast, free, low-latency camera wall for Frigate, on Windows, macOS and Linux.',
			favicon: '/favicon.svg',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/kerwincarpede/ruru' }],
			editLink: {
				baseUrl: 'https://github.com/kerwincarpede/ruru/edit/main/src/ruru-docs/',
			},
			// The app's font and the site's colours, shared with the landing page.
			customCss: [
				'@fontsource-variable/instrument-sans',
				'@fontsource-variable/geist-mono',
				'./src/styles/tokens.css',
				'./src/styles/theme.css',
			],
			components: {
				SiteTitle: './src/components/starlight/SiteTitle.astro',
			},
			expressiveCode: {
				styleOverrides: {
					borderRadius: '0.75rem',
					borderColor: 'var(--ru-hair)',
					codeBackground: 'var(--ru-code-bg)',
				},
			},
			sidebar: [
				section('Get started', 'get-started'),
				section('The wall', 'wall'),
				section('Guides', 'guides'),
				section('Reference', 'reference'),
				section('Contribute', 'contribute'),
			],
		}),
	],
});
