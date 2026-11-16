/**
 * Langfuse tracing for deepagents runs — one CallbackHandler per process,
 * attached to every invoke/stream when env keys are present; zero overhead
 * when they're not. Self-hostable (LANGFUSE_BASE_URL), no external account
 * required for local runs.
 */
import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";

let cached: BaseCallbackHandler | null | undefined;

export async function langfuseCallbacks(): Promise<BaseCallbackHandler[]> {
  if (cached === undefined) {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (publicKey && secretKey) {
      try {
        // The handler reads LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY /
        // LANGFUSE_BASE_URL from the environment by default.
        const { CallbackHandler } = await import("@langfuse/langchain");
        cached = new CallbackHandler() as unknown as BaseCallbackHandler;
      } catch (e) {
        console.warn("[tracing] @langfuse/langchain unavailable — tracing off:", (e as Error)?.message);
        cached = null;
      }
    } else {
      cached = null;
    }
  }
  return cached ? [cached] : [];
}
