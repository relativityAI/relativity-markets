/**
 * Checkpointer — SQLite-backed LangGraph state, so runs are resumable and
 * human-in-the-loop interrupts survive a restart. One saver per process;
 * the file lives beside the rest of the app data (services/data/).
 */
import { join } from "node:path";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

let saver: BaseCheckpointSaver | null = null;

export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (!saver) {
    const { SqliteSaver } = await import("@langchain/langgraph-checkpoint-sqlite");
    saver = SqliteSaver.fromConnString(join(process.cwd(), "data", "checkpoints.db")) as unknown as BaseCheckpointSaver;
  }
  return saver;
}
