import { useEffect, useState } from "react";
import { SkillService, type SkillSummary } from "@/db";

/**
 * The skill library hook — the run result's skill tags read the same list
 * the New Run plugin picker and skills APIs serve.
 */
export function useSkillLibrary() {
    const [library, setLibrary] = useState<SkillSummary[]>([]);
    const [loading, setLoading] = useState(true);
    // A failed fetch must never read as "0 skills" — the caller renders an
    // honest error instead of an empty library.
    const [error, setError] = useState(false);

    const reload = () => {
        setLoading(true);
        SkillService.listSkills()
            .then((data) => {
                setLibrary(Array.isArray(data) ? data : []);
                setError(false);
            })
            .catch(() => {
                setLibrary([]);
                setError(true);
            })
            .finally(() => setLoading(false));
    };

    useEffect(reload, []);
    return { library, loading, error, reload, setLibrary };
}
