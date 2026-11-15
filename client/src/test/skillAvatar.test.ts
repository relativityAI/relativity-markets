import { describe, it, expect } from "vitest";
import { skillAvatarSvg, skillSeed } from "@/lib/skillIdentity";
import { avatarDelay } from "@/lib/agentIdentity";

describe("skill avatar (Loops, animated)", () => {
    it("emits the fastest animation variant, phased per seed", () => {
        const a = skillAvatarSvg(skillSeed({ id: "chartist" }));
        const b = skillAvatarSvg(skillSeed({ id: "dcf" }));
        expect(a).toContain("dblo-fastest"); // animationVariant: "fastest"
        expect(a).toContain("dbloTurn");
        // Deterministic per skill, but two skills must not share a phase.
        expect(avatarDelay(skillSeed({ id: "chartist" }))).not.toBe(
            avatarDelay(skillSeed({ id: "dcf" }))
        );
        expect(b).toContain("dblo-fastest");
    });
});
