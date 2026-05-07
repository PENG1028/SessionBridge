// ─── When Condition Evaluator (Client-safe) ──────────────────
// Lightweight version of the server-side when engine.
// Supports: ==, !=, &&, ||, !, parentheses, bare truthy checks.
// Regex-based — does not build AST.

'use client';

export interface WhenContext {
  view?: string;
  activeAdapterId?: string;
  isRunning?: boolean;
  [key: string]: unknown;
}

/**
 * Evaluate a when condition expression against a context.
 * Returns `true` for empty/undefined expressions.
 */
export function evaluateWhen(expression: string | undefined, ctx: WhenContext): boolean {
  if (!expression || expression.trim() === '') return true;
  try {
    return evaluateOr(expression.trim(), ctx);
  } catch {
    return true; // fail open
  }
}

function evaluateOr(expr: string, ctx: WhenContext): boolean {
  // Split by || at top level (not inside parentheses)
  const parts = splitTopLevel(expr, '||');
  for (const part of parts) {
    if (evaluateAnd(part.trim(), ctx)) return true;
  }
  return false;
}

function evaluateAnd(expr: string, ctx: WhenContext): boolean {
  const parts = splitTopLevel(expr, '&&');
  for (const part of parts) {
    if (!evaluateNot(part.trim(), ctx)) return false;
  }
  return true;
}

function evaluateNot(expr: string, ctx: WhenContext): boolean {
  const trimmed = expr.trim();
  if (trimmed.startsWith('!')) {
    return !evaluatePrimary(trimmed.slice(1).trim(), ctx);
  }
  return evaluatePrimary(trimmed, ctx);
}

function evaluatePrimary(expr: string, ctx: WhenContext): boolean {
  // Parenthesized expression
  if (expr.startsWith('(') && expr.endsWith(')')) {
    return evaluateOr(expr.slice(1, -1).trim(), ctx);
  }

  // Comparison: key == value or key != value
  const eqMatch = expr.match(/^(\S+)\s*==\s*(.+)$/);
  if (eqMatch) {
    const key = eqMatch[1].trim();
    let val = eqMatch[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return String(ctx[key] ?? '') === val;
  }

  const neqMatch = expr.match(/^(\S+)\s*!=\s*(.+)$/);
  if (neqMatch) {
    const key = neqMatch[1].trim();
    let val = neqMatch[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return String(ctx[key] ?? '') !== val;
  }

  // Bare identifier = truthy check
  const ctxVal = ctx[expr];
  return ctxVal === true || ctxVal === 'true' || String(ctxVal) === 'true';
}

function splitTopLevel(expr: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') depth--;
    else if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(expr.slice(start, i));
      i += op.length;
      start = i;
      continue;
    }
    i++;
  }
  parts.push(expr.slice(start));
  return parts;
}
