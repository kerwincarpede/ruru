// Fails the docs build when the site's owl (src/components/Owl.astro) no
// longer matches the app's (src/ruru/src/app/Owl.tsx and owl.css), so a
// change to the owl in the app can't leave the site behind. docs.yml builds
// the site whenever either file changes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const app = read('../../ruru/src/app/Owl.tsx');
const site = read('../src/components/Owl.astro');
const css = read('../../ruru/src/app/owl.css');

const problems = [];

// The drawing: the constants and the SVG markup, with the JSX spellings
// turned into their SVG ones and the formatting taken out. The site's only
// addition is data-follow, which lets the pupils follow the pointer.
const constants = (source) => source.match(/^const (?:EYES|CY|R|LOOK_RANGE) = [^;]+;/gms)?.join('\n') ?? '';
const svg = (source) => source.slice(source.indexOf('<svg'), source.indexOf('</svg>') + '</svg>'.length);
const normalise = (source) =>
	source
		.replace(/\s+key=\{side\}/g, '')
		.replace(/\s+data-follow=\{[^}]*\}/g, '')
		.replace(/\bclassName=/g, 'class=')
		.replace(/\bstopColor=/g, 'stop-color=')
		.replace(/\bstopOpacity=/g, 'stop-opacity=')
		.replace(/\bclipPath=/g, 'clip-path=')
		.replace(/'/g, '"')
		.replace(/\s+/g, ' ')
		.replace(/\s*([<>{}()[\],=])\s*/g, '$1')
		.replace(/,([\]}])/g, '$1')
		.trim();

const compare = (what, a, b) => {
	const left = normalise(a);
	const right = normalise(b);
	if (left === right) return;
	let at = 0;
	while (left[at] === right[at]) at++;
	problems.push(`${what} differs:\n  app:  …${left.slice(Math.max(0, at - 40), at + 60)}…\n  site: …${right.slice(Math.max(0, at - 40), at + 60)}…`);
};

compare('The owl constants', constants(app), constants(site));
compare('The owl markup', svg(app), svg(site));

// The colours: the site sets the app's light and dark sets from its own
// theme switch, so both must match owl.css.
const sets = (source) =>
	[...source.matchAll(/(--owl-(?:brow|beak|glow)):\s*([^;]+);/g)].map(([, name, value]) => `${name}: ${value.trim()}`).filter((line, i, all) => all.indexOf(line) === i);
const appColours = sets(css).sort().join('\n');
const siteColours = sets(site.slice(site.indexOf('<style'))).sort().join('\n');
if (appColours !== siteColours) {
	problems.push(`The owl colours differ:\n  app (owl.css):\n    ${appColours.replaceAll('\n', '\n    ')}\n  site (Owl.astro):\n    ${siteColours.replaceAll('\n', '\n    ')}`);
}

if (problems.length) {
	console.error(`The site's owl no longer matches the app's. Update src/ruru-docs/src/components/Owl.astro.\n\n${problems.join('\n\n')}`);
	process.exit(1);
}
console.log("The site's owl matches the app's.");
