import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AgentSkills from "@/pages/console/AgentSkills";

const state = vi.hoisted(() => ({
    skills: [
        {
            id: "chartist-playbook", name: "Chartist Playbook", description: "Technicals.",
            category: "market", version: 1, source: "builtin",
            created_at: "2026-01-15T00:00:00.000Z", tags: ["technical", "momentum"],
        },
        {
            id: "my-skill", name: "My Skill", description: "Mine.",
            category: "custom", version: 1, source: "custom",
            created_at: "2026-02-03T00:00:00.000Z", tags: ["research"],
        },
    ] as any[],
}));

vi.mock("@/db", () => ({
    SkillService: { deleteSkill: vi.fn(), listSkills: vi.fn(), saveSkill: vi.fn(), updateSkill: vi.fn() },
}));

vi.mock("@/components/skills/SkillBrowser", () => ({
    useSkillLibrary: () => ({ library: state.skills, loading: false, error: false, setLibrary: vi.fn() }),
}));

vi.mock("@/components/shared/SkillAvatar", () => ({ default: () => <div data-testid="skill-avatar" /> }));
vi.mock("@/compat/ui", () => ({ toaster: { create: vi.fn() } }));

describe("AgentSkills list", () => {
    it("shows each skill's created date and its frontmatter tags", () => {
        render(<MemoryRouter><AgentSkills /></MemoryRouter>);

        expect(screen.getAllByText("Created 15 Jan 2026")).toHaveLength(1);
        expect(screen.getAllByText("Created 3 Feb 2026")).toHaveLength(1);
        for (const tag of ["technical", "momentum", "research"]) {
            expect(screen.getByText(tag)).toBeTruthy();
        }
    });
});
