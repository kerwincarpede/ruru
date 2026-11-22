import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  checked?: boolean;
  onSelect: () => void;
}

interface WallMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** The wall's right-click menu, drawn in the page at the pointer. */
export default function WallMenu({ x, y, items, onClose }: WallMenuProps) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Kept inside the window when opened near its right or bottom edge.
  const left = Math.max(0, Math.min(x, window.innerWidth - 220));
  const top = Math.max(0, Math.min(y, window.innerHeight - 40 * items.length - 12));
  return (
    <div ref={menu} className="wall-menu" role="menu" style={{ left, top }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role={item.checked === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={item.checked}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
