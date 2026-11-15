import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SectionSearch } from "@/components/console/SectionSearch";

describe("SectionSearch", () => {
  it("expands on click", () => {
    render(<SectionSearch label="Search x" placeholder="Search…" value="" onChange={() => {}} />);
    const btn = screen.getByRole("button", { name: "Search x" });
    const input = document.querySelector("input")!;
    const box = btn.parentElement!;
    expect(box.getAttribute("style")).toContain("36px");
    fireEvent.click(btn);
    expect(box.getAttribute("style")).toContain("192px");
    expect(input.getAttribute("aria-hidden")).toBe("false");
  });

  it("collapses 5s after typing stops while empty", () => {
    vi.useFakeTimers();
    render(<SectionSearch label="Search y" placeholder="Search…" value="" onChange={() => {}} />);
    const btn = screen.getByRole("button", { name: "Search y" });
    const box = btn.parentElement!;
    fireEvent.click(btn);
    expect(box.getAttribute("style")).toContain("192px");
    act(() => { vi.advanceTimersByTime(5100); });
    expect(box.getAttribute("style")).toContain("36px");
    vi.useRealTimers();
  });
});
