import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import { mockCommands } from "./test/mockCommands";

describe("App", () => {
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

  it("ignores an app_info answer that arrives after the window is gone", async () => {
    let answer: ((info: { name: string; version: string }) => void) | null = null;
    mockCommands({ app_info: () => new Promise((resolve) => (answer = resolve)) });
    const { unmount } = render(<App />);
    await waitFor(() => expect(answer).not.toBeNull());
    unmount();
    answer!({ name: "Ruru", version: "0.1.0" });
    await Promise.resolve();
    expect(screen.queryByText("Ruru 0.1.0")).not.toBeInTheDocument();
  });
});
