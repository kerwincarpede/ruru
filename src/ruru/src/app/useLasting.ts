import { useEffect, useState } from "react";

/**
 * Whether `on` has stayed true for `ms`. Each time `on` turns true the wait
 * starts again, so a short spell that ends and comes back never counts early.
 */
export function useLasting(on: boolean, ms: number): boolean {
  const [spell, setSpell] = useState({ on: false, count: 0 });
  if (spell.on !== on) setSpell({ on, count: spell.count + (on ? 1 : 0) });
  const [late, setLate] = useState(0);
  useEffect(() => {
    if (!on) return;
    const count = spell.count;
    const timer = setTimeout(() => setLate(count), ms);
    return () => clearTimeout(timer);
  }, [on, spell.count, ms]);
  return on && spell.count > 0 && late === spell.count;
}
