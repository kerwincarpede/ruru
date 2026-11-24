// The owl's pupils drift a little towards the pointer. Each owl that does
// this has data-follow set to how far its pupils may move, in the SVG's own
// units, and its CSS moves the pupils by --follow-x and --follow-y with the
// `translate` property, which adds to any mood's own `transform` animation.
// Only for a mouse or trackpad, and never under prefers-reduced-motion.

/** How far, in CSS pixels, the pointer must be for the pupils to look all the way. */
const REACH = 320;

const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
const still = window.matchMedia('(prefers-reduced-motion: reduce)');

let pointer: { x: number; y: number } | null = null;
let frame = 0;

const update = () => {
	frame = 0;
	for (const owl of document.querySelectorAll<SVGSVGElement>('svg[data-follow]')) {
		let x = 0;
		let y = 0;
		if (pointer && fine.matches && !still.matches) {
			const box = owl.getBoundingClientRect();
			const dx = pointer.x - (box.left + box.width / 2);
			const dy = pointer.y - (box.top + box.height / 2);
			const distance = Math.hypot(dx, dy);
			if (distance > 0) {
				const pull = (Math.min(distance, REACH) / REACH) * Number(owl.dataset.follow);
				x = (dx / distance) * pull;
				// Owls look up and down less than side to side.
				y = (dy / distance) * pull * 0.6;
			}
		}
		owl.style.setProperty('--follow-x', `${x.toFixed(2)}px`);
		owl.style.setProperty('--follow-y', `${y.toFixed(2)}px`);
	}
};

const schedule = () => {
	if (!frame) frame = requestAnimationFrame(update);
};

document.addEventListener(
	'pointermove',
	(event) => {
		if (event.pointerType !== 'mouse') return;
		pointer = { x: event.clientX, y: event.clientY };
		schedule();
	},
	{ passive: true },
);
// Leaving the window: the eyes come back to the middle.
document.documentElement.addEventListener('pointerleave', () => {
	pointer = null;
	schedule();
});
window.addEventListener('scroll', schedule, { passive: true });
still.addEventListener('change', schedule);
