import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/db", () => ({
    AnalysisService: { readAnalysis: vi.fn() },
    API_BASE: "/api",
}));
vi.mock("@/components/skills/SkillBrowser", () => ({
    useSkillLibrary: () => ({ library: [] }),
}));
vi.mock("../components/shared/AgentActivity", () => ({ default: () => null }));
vi.mock("@/components/report/ReportDocumentRenderer", () => ({
    ReportDocumentRenderer: () => <div data-testid="report-doc" />,
}));
vi.mock("@/components/report/WorkspaceExplorer", () => ({ WorkspaceExplorer: () => null }));

import { AnalysisService } from "@/db";
import AnalysisResult from "@/pages/AnalysisResult";

const baseRun = {
    id: "r1",
    status: "complete",
    share_name: "Acme Ltd",
    symbol: "ACME",
    model: "gpt-x",
    created_at: "2026-01-01T00:00:00Z",
    duration: 42,
    skill_outputs: [],
    trace: [],
};

function wrap(ui: React.ReactElement) {
    return (
        <>
            <MemoryRouter initialEntries={["/analysis-result/r1"]}>
                <Routes>
                    <Route path="/analysis-result/:id" element={ui} />
                </Routes>
            </MemoryRouter>
        </>
    );
}

async function expectRunInfoHasDuration() {
    fireEvent.click(screen.getByRole("tab", { name: /run info/i }));
    expect(await screen.findByText("Duration")).toBeTruthy();
    expect(screen.getByText("42s")).toBeTruthy();
}

describe("AnalysisResult navbar", () => {
    beforeEach(() => vi.clearAllMocks());

    it("legacy run: back link, pill tabs and download share one line", async () => {
        vi.mocked(AnalysisService.readAnalysis).mockResolvedValue({ ...baseRun });
        render(wrap(<AnalysisResult />));
        expect(await screen.findByText("Acme Ltd")).toBeTruthy();

        expect(screen.getByRole("link", { name: /back to runs/i })).toBeTruthy();
        for (const label of ["Report", "Reasoning", "Run Info"]) {
            expect(screen.getByRole("tab", { name: new RegExp(`^${label}`, "i") })).toBeTruthy();
        }
        expect(screen.getByRole("button", { name: /download as pdf/i })).toBeTruthy();

        // Selected tab is wired to the pill state (variant="subtle" tints it).
        expect(screen.getByRole("tab", { name: /^report/i }).getAttribute("aria-selected")).toBe("true");
        expect(screen.getByRole("tab", { name: /^reasoning/i }).getAttribute("aria-selected")).toBe("false");

        // Metadata lives on the Run Info tab, not under the report.
        await expectRunInfoHasDuration();
    });

    it("harness run: report / agent workspace / run info on one line", async () => {
        vi.mocked(AnalysisService.readAnalysis).mockResolvedValue({
            ...baseRun,
            report_document: { symbol: "ACME", sections: [] },
        });
        render(wrap(<AnalysisResult />));
        expect(await screen.findByTestId("report-doc")).toBeTruthy();

        expect(screen.getByRole("link", { name: /back to runs/i })).toBeTruthy();
        for (const label of ["Report", "Agent Workspace", "Run Info"]) {
            expect(screen.getByRole("tab", { name: new RegExp(`^${label}`, "i") })).toBeTruthy();
        }
        expect(screen.getByRole("button", { name: /download as pdf/i })).toBeTruthy();

        await expectRunInfoHasDuration();
    });

    it("harness run: big logo, stock name, ticker and verdict lead the report", async () => {
        vi.mocked(AnalysisService.readAnalysis).mockResolvedValue({
            ...baseRun,
            source: "SEC",
            report_document: { symbol: "ACME", verdict: "Fair", sections: [] },
        });
        render(wrap(<AnalysisResult />));
        await screen.findByTestId("report-doc");

        const logo = document.querySelector('img[title="ACME"]') as HTMLImageElement;
        expect(logo).toBeTruthy();
        expect(logo.getAttribute("src")).toContain("/logo/ACME");
        expect(logo.style.width).toBe("128px");

        // Name and ticker share one line beside the big logo; no "Verdict" label.
        const header = logo.parentElement!;
        expect(header.textContent).toContain("Acme Ltd");
        expect(header.textContent).toContain("ACME");
        expect(header.textContent).not.toContain("Verdict");
        const name = within(header).getByText("Acme Ltd");
        const ticker = within(header).getByText("ACME");
        expect(name.parentElement).toBe(ticker.parentElement);
        expect(getComputedStyle(name).color).not.toBe(getComputedStyle(ticker).color);
        expect(parseFloat(getComputedStyle(screen.getByText("Fair")).fontSize)).toBeGreaterThan(40);
    });

    it("failed harness run: says why it failed, points at Settings keys, offers retry", async () => {
        vi.mocked(AnalysisService.readAnalysis).mockResolvedValue({
            ...baseRun,
            status: "failed",
            error: "401 Unauthorized: no provider key",
            report_document: { symbol: "ACME", sections: [] },
        });
        render(wrap(<AnalysisResult />));

        expect(await screen.findByText("401 Unauthorized: no provider key")).toBeTruthy();
        expect(screen.getByText(/check settings → api keys/i)).toBeTruthy();
        expect(screen.getByRole("button", { name: /^retry$/i })).toBeTruthy();
    });
});
