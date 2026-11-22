import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { findUpdate } from "./app/updates";
import { mockCommands } from "./test/mockCommands";

vi.mock("./app/updates", () => ({ findUpdate: vi.fn() }));

const findUpdateMock = vi.mocked(findUpdate);

describe("App", () => {
  beforeEach(() => {
    findUpdateMock.mockReset().mockResolvedValue(null);
  });

  it("shows the name, the tagline and that Frigate connection is coming", () => {
    mockCommands({ app_info: () => ({ name: "Ruru", version: "0.1.0" }) });
    render(<App />);
    expect(screen.getByRole("heading", { name: "Ruru" })).toBeInTheDocument();
    expect(screen.getByText("Eyes on every camera")).toBeInTheDocument();
    expect(screen.getByText(/Frigate server is coming/)).toBeInTheDocument();
  });

  it("shows the name and version from app_info in the footer", async () => {
    const calls = mockCommands({ app_info: () => ({ name: "Ruru", version: "1.2.3" }) });
    render(<App />);
    const footer = screen.getByRole("contentinfo", { name: "About Ruru" });
    await waitFor(() => expect(footer).toHaveTextContent("Ruru 1.2.3"));
    expect(calls.map((call) => call.cmd)).toEqual(["app_info"]);
  });

  it("leaves the footer empty when app_info fails", async () => {
    const calls = mockCommands({
      app_info: () => {
        throw new Error("backend unavailable");
      },
    });
    render(<App />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.getByRole("contentinfo", { name: "About Ruru" })).toBeEmptyDOMElement();
    expect(screen.getByRole("heading", { name: "Ruru" })).toBeInTheDocument();
  });

  it("checks for an update once at startup and shows no prompt without one", async () => {
    mockCommands({ app_info: () => ({ name: "Ruru", version: "0.1.0" }) });
    render(<App />);
    await waitFor(() => expect(findUpdateMock).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers the update it finds, and Not now puts the prompt away", async () => {
    mockCommands({ app_info: () => ({ name: "Ruru", version: "0.1.0" }) });
    const install = vi.fn().mockResolvedValue(undefined);
    findUpdateMock.mockResolvedValue({ version: "0.2.0", install });
    render(<App />);
    const dialog = await screen.findByRole("dialog", { name: "Ruru 0.2.0 is ready. Install and restart?" });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();
  });

  it("installs the update it finds when asked", async () => {
    mockCommands({ app_info: () => ({ name: "Ruru", version: "0.1.0" }) });
    const install = vi.fn().mockResolvedValue(undefined);
    findUpdateMock.mockResolvedValue({ version: "0.2.0", install });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Install and restart" }));
    expect(install).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
