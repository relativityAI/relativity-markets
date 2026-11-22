import axios from "axios";
import { API_BASE } from "@/db";

/** Named system prompts (services/harness/assets/agent.yaml prompts.*). */
export interface SystemPromptSummary {
  id: string;
  name: string;
  description: string;
  default?: boolean;
}

export async function listSystemPrompts(): Promise<SystemPromptSummary[]> {
  return (await axios.get(`${API_BASE}/harness/system-prompts`)).data;
}
