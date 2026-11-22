import { Fragment, useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";
import type { MenuSection } from "./menu";

export type { MenuItem, MenuSection } from "./menu";

interface WallMenuProps {
  x: number;
  y: number;
  sections: MenuSection[];
  onClose: () => void;
}

/** Space kept between the menu and the window's edge. */
const EDGE = 4;

const ROLES = { radio: "menuitemradio", checkbox: "menuitemcheckbox" } as const;

/** The wall's right-click menu, drawn in the page at the pointer and kept inside the window. */
export default function WallMenu({ x, y, sections, onClose }: WallMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
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

  // Opened near the right or bottom edge, the menu moves by its measured size to stay in the window.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    element.style.left = `${Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE))}px`;
    element.style.top = `${Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE))}px`;
  }, [x, y, sections]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (index: number) => items[(index + items.length) % items.length]?.focus();
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at < 0 ? -1 : at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(-1);
    else if (event.key === "Escape" || event.key === "Tab") onClose();
    else return;
    event.preventDefault();
    // Escape closes only the menu, not a maximised camera behind it.
    event.stopPropagation();
  };

  return (
    <div
      ref={menu}
      className="wall-menu"
      role="menu"
      aria-label={sections[0]?.label ?? "Wall"}
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
    >
      {sections.map((section, index) => (
        <Fragment key={section.label ?? section.name ?? index}>
          {index > 0 && <div role="separator" className="wall-menu-separator" />}
          {section.label && (
            <>
              <div id={`${id}-${index}`} className="wall-menu-header" aria-hidden="true">
                {section.label}
              </div>
              <div role="separator" className="wall-menu-separator" />
            </>
          )}
          <div role="group" aria-labelledby={section.label ? `${id}-${index}` : undefined} aria-label={section.label ? undefined : section.name}>
            {section.items.map((item) => (
              <button
                key={item.label}
                type="button"
                tabIndex={-1}
                role={item.kind ? ROLES[item.kind] : "menuitem"}
                aria-checked={item.kind ? Boolean(item.checked) : undefined}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
