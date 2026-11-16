import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SectionSearch } from "@/components/console/SectionSearch";

// Widths live in CSS (.section-search 36px → [data-open="true"] 192px in
// index.css), so these assert the data-open state the CSS keys off of.
describe("SectionSearch", () => {
  it("expands on click", () => {
    render(<SectionSearch label="Search x" placeholder="Search…" value="" onChange={() => {}} />);
    const btn = screen.getByRole("button", { name: "Search x" });
    const input = document.querySelector("input")!;
    const box = btn.parentElement!;
    expect(box.getAttribute("data-open")).toBe("false");
    fireEvent.click(btn);
    expect(box.getAttribute("data-open")).toBe("true");
    expect(input.getAttribute("aria-hidden")).toBe("false");
  });

  it("collapses 5s after typing stops while empty", () => {
    vi.useFakeTimers();
    render(<SectionSearch label="Search y" placeholder="Search…" value="" onChange={() => {}} />);
    const btn = screen.getByRole("button", { name: "Search y" });
    const box = btn.parentElement!;
    fireEvent.click(btn);
    expect(box.getAttribute("data-open")).toBe("true");
    act(() => { vi.advanceTimersByTime(5100); });
    expect(box.getAttribute("data-open")).toBe("false");
    vi.useRealTimers();
  });
});
