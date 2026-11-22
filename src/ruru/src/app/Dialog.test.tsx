import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Dialog from "./Dialog";

function open(children = <><button type="button">First</button><button type="button">Last</button></>) {
  const onClose = vi.fn();
  const view = render(
    <>
      <button type="button">Outside</button>
      <Dialog title="Example" onClose={onClose}>
        {children}
      </Dialog>
    </>,
  );
  return { onClose, view };
}

describe("Dialog", () => {
  it("shows its title and focuses itself when nothing asks for focus", () => {
    open();
    const dialog = screen.getByRole("dialog", { name: "Example" });
    expect(screen.getByRole("heading", { name: "Example" })).toBeInTheDocument();
    expect(dialog).toHaveFocus();
  });

  it("keeps Tab inside the dialog in both directions", () => {
    open();
    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    first.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(first).toHaveFocus();
  });

  it("ignores Tab when it holds nothing to focus, and other keys", () => {
    const { onClose } = open(<p>Nothing to focus</p>);
    fireEvent.keyDown(window, { key: "Tab" });
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a click on the backdrop but not inside", () => {
    const { onClose } = open();
    fireEvent.pointerDown(screen.getByRole("button", { name: "First" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves Escape to a dialog opened inside it", () => {
    const { onClose } = open(<div role="dialog" aria-modal="true" aria-label="Inner"><button type="button">Inner</button></div>);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("gives focus back when it closes", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    const { view } = open();
    view.unmount();
    expect(outside).toHaveFocus();
    outside.remove();
  });
});
