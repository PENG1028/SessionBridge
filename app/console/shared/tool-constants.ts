export const TOOL_SEMANTICS: Record<string, { label: string; icon: string; phase: string }> = {
  Read:        { label: 'Reading file',       icon: 'Eye',     phase: 'scan' },
  Glob:        { label: 'Scanning files',      icon: 'Search',  phase: 'scan' },
  Grep:        { label: 'Searching code',      icon: 'Search',  phase: 'search' },
  Bash:        { label: 'Running command',     icon: 'Terminal',phase: 'exec' },
  PowerShell:  { label: 'Running command',     icon: 'Terminal',phase: 'exec' },
  Edit:        { label: 'Editing code',        icon: 'FileCode',phase: 'edit' },
  Write:       { label: 'Writing file',        icon: 'FileCode',phase: 'edit' },
  WebSearch:   { label: 'Searching web',       icon: 'Globe',   phase: 'search' },
  WebFetch:    { label: 'Fetching URL',        icon: 'Globe',   phase: 'search' },
};

export const UNKNOWN_TOOL = { label: 'Unknown Activity', icon: 'AlertCircle', phase: 'unknown' };

export function getSemantic(name: string): { label: string; icon: string; phase: string } {
  return TOOL_SEMANTICS[name] || UNKNOWN_TOOL;
}
