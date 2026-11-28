import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateTimePicker, type DateTimeValue } from "@/pages/shared/DateTimePicker";

function openPicker(initial: DateTimeValue = { date: "2026-11-22", time: "09:00" }) {
  const onChange = vi.fn();
  render(<DateTimePicker value={initial} onChange={onChange} />);
  fireEvent.click(screen.getByTestId("schedule-datetime"));
  return onChange;
}

describe("DateTimePicker", () => {
  // The picker disables days before today (DateTimePicker.tsx: `key < todayKey`),
  // so pin "today" to the date these assertions were written against.
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T09:00:00"));
  });
  afterAll(() => vi.useRealTimers());

  it("commits the clicked day, not the month cursor", () => {
    const onChange = openPicker();
    // Month cursor sits on 11/22 (today); pick the 25th, keep the time.
    fireEvent.click(screen.getByRole("button", { name: "2026-11-25" }));
    fireEvent.click(screen.getByTestId("schedule-datetime-ok"));

    expect(onChange).toHaveBeenCalledWith({ date: "2026-11-25", time: "09:00" });
  });

  it("commits the steered time with AM/PM applied", () => {
    const onChange = openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Increase hour" })); // 10 → 10 AM
    fireEvent.click(screen.getByRole("button", { name: "PM" }));
    fireEvent.click(screen.getByTestId("schedule-datetime-ok"));

    expect(onChange).toHaveBeenCalledWith({ date: "2026-11-22", time: "22:00" });
  });

  it("re-renders the trigger from the committed value", () => {
    const { rerender } = render(
      <DateTimePicker value={{ date: "2026-11-22", time: "09:00" }} onChange={() => {}} />,
    );
    expect(screen.getByTestId("schedule-datetime").textContent).toContain("11/22/2026 · 9:00 AM");

    rerender(
      <DateTimePicker value={{ date: "2026-12-01", time: "17:30" }} onChange={() => {}} />,
    );
    expect(screen.getByTestId("schedule-datetime").textContent).toContain("12/01/2026 · 5:30 PM");
  });
});
