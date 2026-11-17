/**
 * Shared tool guard.
 *
 * LangChain calls tool functions directly — there is no outer loop wrapper to
 * police them. A tool that "succeeds" with nothing (undefined/null) must not
 * reach the model as OK — OK-with-nothing invites fabrication — so tool
 * bodies in this folder funnel through this guard.
 */
export const NO_RESULT = "tool returned no result";

export async function noResult<T>(run: () => Promise<T>): Promise<T | string> {
  const out = await run();
  if (out == null) return NO_RESULT;
  return out;
}
