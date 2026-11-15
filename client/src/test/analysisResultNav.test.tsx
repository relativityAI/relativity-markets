import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/db", () => ({
    AnalysisService: { readAnalysis: vi.fn() },
    API_BASE: "/api",
}));
vi.mock("@/components/skills/SkillBrowser", () => ({
    useSkillLibrary: () => ({ library: [] }),
}));
vi.mock("@/components/skills/SkillResultCard", () => ({ default: () => null }));
vi.mock("../components/shared/AgentActivity", () => ({ default: () => null }));
vi.mock("@/components/report/ReportDocumentRenderer", () => ({
    ReportDocumentRenderer: () => <div data-testid="report-doc" />,
}));
vi.mock("@/components/report/RunReasoningTimeline", () => ({ default: () => null }));
vi.mock("@/components/report/WorkspaceExplorer", () => ({ WorkspaceExplorer: () => null }));

import { AnalysisService } from "@/db";
import AnalysisResult from "@/pages/AnalysisResult";
import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";

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
        <ChakraProvider value={createSystem(defaultConfig)}>
            <MemoryRouter initialEntries={["/analysis-result/r1"]}>
                <Routes>
                    <Route path="/analysis-result/:id" element={ui} />
                </Routes>
            </MemoryRouter>
        </ChakraProvider>
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
});
