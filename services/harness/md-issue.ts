export interface MdIssue {
  line: number;
  message: string;
  severity?: "error" | "warn";
}
