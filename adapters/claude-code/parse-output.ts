// ─── Claude Code Output Parser ────────────────────────────────
// Extracts structured info (model, version, cwd) from Claude's
// raw terminal output lines. Used by the WebSocket hook.

export interface ParsedClaudeOutput {
  model?: string;
  version?: string;
  cwd?: string;
  task?: string;
  tool?: string;
  toolArgs?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: string;
}

/**
 * Parse a raw output line from Claude Code's terminal output.
 * Returns an update to merge into the current parsed state.
 */
export function parseClaudeOutputLine(
  data: string,
  current: ParsedClaudeOutput,
): Partial<ParsedClaudeOutput> {
  const update: Partial<ParsedClaudeOutput> = {};

  // Claude Code version header: "Claude Code v2.1.123 deepseek-v4-flash"
  // or "ClaudeCode v2.1.123 deepseek-v4-flash · API Usage Billing <cwd>"
  const headerMatch = data.match(/(?:Claude\s*Code)\s+(v[\d.]+)\s+([\w.-]+)/);
  if (headerMatch) {
    update.version = headerMatch[1];
    if (!current.model) update.model = headerMatch[2];
  }

  // Extract cwd from status line: "· API Usage Billing F:\path"
  const cwdMatch = data.match(/Billing\s+((?:[A-Za-z]:)?[\\/][^\s[?]*[^\s[?;,])/);
  if (cwdMatch) {
    update.cwd = cwdMatch[1].trim();
  } else if (!current.cwd) {
    const altCwd = data.match(/(?:API\s*Usage|Billing)\s+((?:[A-Za-z]:)?[\\/][^\r\n[?]{2,}?)/);
    if (altCwd && altCwd[1].trim().length > 3) {
      update.cwd = altCwd[1].trim();
    }
  }

  // Tool progress indicators
  const toolMatch = data.match(/●\s*(\w[\w\s]*?)(?:\s*\(([^)]+)\))?$/m);
  if (toolMatch) {
    update.tool = toolMatch[1].trim();
    if (toolMatch[2]) update.toolArgs = toolMatch[2];
  }

  return update;
}
