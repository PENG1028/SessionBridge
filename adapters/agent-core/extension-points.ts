// ─── Extension Points Registry + When Condition Engine ──────────
// Aggregates all extension contributions (views, commands, menus,
// configuration, languages) from loaded manifests and provides a
// when-condition evaluator for visibility gating.
//
// Usage:
//   import { extensionPoints, evaluateWhen } from './extension-points';
//   extensionPoints.register('my-ext', manifest);
//   const panels = extensionPoints.getViews('sidebar-right', ctx);
//   const cmds = extensionPoints.getCommands(ctx);

import type {
  ExtensionManifest, SidePanelContribution, CommandContribution,
  MenuContribution, WhenContext, NotificationContribution,
} from '../types';
import { adapterRegistry } from '../registry';
import { panelRegistry } from './panel-registry';

// ═══════════════════════════════════════════════════════════════
// When Condition Engine — recursive descent parser
// ═══════════════════════════════════════════════════════════════

enum TokenType {
  IDENTIFIER, STRING, EQ, NEQ, AND, OR, NOT, LPAREN, RPAREN, EOF,
}

interface Token {
  type: TokenType;
  value: string;
}

function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') { tokens.push({ type: TokenType.LPAREN, value: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: TokenType.RPAREN, value: ')' }); i++; continue; }
    if (ch === '!' && input[i + 1] !== '=') { tokens.push({ type: TokenType.NOT, value: '!' }); i++; continue; }
    if (ch === '&' && input[i + 1] === '&') { tokens.push({ type: TokenType.AND, value: '&&' }); i += 2; continue; }
    if (ch === '|' && input[i + 1] === '|') { tokens.push({ type: TokenType.OR, value: '||' }); i += 2; continue; }
    if (ch === '=' && input[i + 1] === '=') { tokens.push({ type: TokenType.EQ, value: '==' }); i += 2; continue; }
    if (ch === '!' && input[i + 1] === '=') { tokens.push({ type: TokenType.NEQ, value: '!=' }); i += 2; continue; }
    if (ch === '"') {
      const end = input.indexOf('"', i + 1);
      if (end === -1) throw new Error(`Unterminated string literal at position ${i}`);
      tokens.push({ type: TokenType.STRING, value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[a-zA-Z0-9_.-]/.test(ch)) {
      const start = i;
      while (i < input.length && /[a-zA-Z0-9_.-]/.test(input[i])) i++;
      tokens.push({ type: TokenType.IDENTIFIER, value: input.slice(start, i) });
      continue;
    }
    // Single quote as alternative to double quote
    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) throw new Error(`Unterminated string literal at position ${i}`);
      tokens.push({ type: TokenType.STRING, value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }
  tokens.push({ type: TokenType.EOF, value: '' });
  return tokens;
}

interface ASTNode {
  type: 'or' | 'and' | 'not' | 'compare' | 'bare';
  op?: string;        // '==', '!='
  left?: ASTNode;
  right?: ASTNode;
  key?: string;
  value?: string;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(input: string) {
    this.tokens = lex(input);
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private consume(type: TokenType): Token {
    const t = this.peek();
    if (t.type !== type) throw new Error(`Expected ${TokenType[type]}, got '${t.value}'`);
    this.pos++;
    return t;
  }

  parse(): ASTNode {
    const result = this.parseOr();
    this.consume(TokenType.EOF);
    return result;
  }

  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.peek().type === TokenType.OR) {
      this.pos++;
      const right = this.parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): ASTNode {
    let left = this.parseNot();
    while (this.peek().type === TokenType.AND) {
      this.pos++;
      const right = this.parseNot();
      left = { type: 'and', left, right };
    }
    return left;
  }

  private parseNot(): ASTNode {
    if (this.peek().type === TokenType.NOT) {
      this.pos++;
      const operand = this.parseNot();
      return { type: 'not', left: operand };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    if (this.peek().type === TokenType.LPAREN) {
      this.pos++;
      const expr = this.parseOr();
      this.consume(TokenType.RPAREN);
      return expr;
    }
    return this.parseComparison();
  }

  private parseComparison(): ASTNode {
    const key = this.consume(TokenType.IDENTIFIER).value;
    // If followed by == or !=, it's a comparison
    if (this.peek().type === TokenType.EQ || this.peek().type === TokenType.NEQ) {
      const op = this.consume(this.peek().type).value;
      const next = this.peek();
      const value = next.type === TokenType.STRING
        ? this.consume(TokenType.STRING).value
        : this.consume(TokenType.IDENTIFIER).value;
      return { type: 'compare', op, key, value };
    }
    // Bare identifier = truthy check
    return { type: 'bare', key };
  }
}

function evalAST(node: ASTNode, ctx: WhenContext): boolean {
  switch (node.type) {
    case 'or':
      return evalAST(node.left!, ctx) || evalAST(node.right!, ctx);
    case 'and':
      return evalAST(node.left!, ctx) && evalAST(node.right!, ctx);
    case 'not':
      return !evalAST(node.left!, ctx);
    case 'bare': {
      const val = ctx[node.key!];
      return val === true || val === 'true' || String(val) === 'true';
    }
    case 'compare': {
      const ctxVal = String(ctx[node.key!] ?? '');
      const cmpVal = node.value!;
      return node.op === '==' ? ctxVal === cmpVal : ctxVal !== cmpVal;
    }
    default:
      return true;
  }
}

/**
 * Evaluate a when condition expression against a context.
 * Returns `true` if the expression is empty or evaluates to true.
 *
 * Examples:
 *   evaluateWhen("view == claude-chat", { view: "claude-chat" })  // true
 *   evaluateWhen("editorHasSelection", { editorHasSelection: true })  // true
 *   evaluateWhen("view != terminal && isRunning", { view: "shell", isRunning: true })  // true
 */
export function evaluateWhen(expression: string | undefined, ctx: WhenContext): boolean {
  if (!expression || expression.trim() === '') return true;
  try {
    const parser = new Parser(expression);
    const ast = parser.parse();
    return evalAST(ast, ctx);
  } catch (err) {
    console.warn(`[when] Failed to evaluate "${expression}":`, (err as Error).message);
    return true; // Fail open — if we can't parse, show the item
  }
}

// ═══════════════════════════════════════════════════════════════
// Extension Points Registry
// ═══════════════════════════════════════════════════════════════

export class ExtensionPointsRegistry {
  private manifests = new Map<string, ExtensionManifest>();

  /** Register an extension's manifest. Called during extension activation. */
  register(adapterId: string, manifest: ExtensionManifest): void {
    this.manifests.set(adapterId, manifest);
    panelRegistry.registerFromManifest(adapterId, manifest);
  }

  /** Unregister an extension's manifest. Called during deactivation. */
  unregister(adapterId: string): void {
    this.manifests.delete(adapterId);
    panelRegistry.unregister(adapterId);
  }

  /** Clear all manifests (used during reload). */
  clear(): void {
    this.manifests.clear();
    panelRegistry.clear();
  }

  /** Get all registered adapter IDs. */
  listExtensions(): string[] {
    return [...this.manifests.keys()];
  }

  /** Get the manifest for a specific extension. */
  getManifest(adapterId: string): ExtensionManifest | undefined {
    return this.manifests.get(adapterId);
  }

  // ─── Adapter → View ID Mapping ──────────────────────────────

  /**
   * Get mapping of adapter ID → view ID for all registered extensions.
   * Used by the client to resolve which view component to render for each adapter.
   */
  getAdapterViews(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [adapterId, manifest] of this.manifests) {
      if (manifest.viewId) {
        result[adapterId] = manifest.viewId;
      }
    }
    return result;
  }

  // ─── View Contributions ────────────────────────────────────

  /**
   * Get side panel contributions for the given sidebar, optionally
   * filtered by when condition and sorted by order.
   */
  getViews(
    side: 'sidebar-left' | 'sidebar-right',
    ctx?: WhenContext,
  ): SidePanelContribution[] {
    return panelRegistry.getPanels(side, ctx);
  }

  // ─── Command Contributions ─────────────────────────────────

  /**
   * Get all extension-contributed commands, optionally filtered
   * by when condition.
   */
  getCommands(ctx?: WhenContext): CommandContribution[] {
    const result: CommandContribution[] = [];
    for (const manifest of this.manifests.values()) {
      const cmds = manifest.contributes?.commands;
      if (!cmds) continue;
      for (const cmd of cmds) {
        if (ctx === undefined || evaluateWhen(cmd.when, ctx)) {
          result.push(cmd);
        }
      }
    }
    return result;
  }

  /**
   * Find a single command contribution by ID.
   */
  findCommand(id: string): CommandContribution | undefined {
    for (const manifest of this.manifests.values()) {
      const cmd = manifest.contributes?.commands?.find(c => c.id === id);
      if (cmd) return cmd;
    }
    return undefined;
  }

  // ─── Menu Contributions ────────────────────────────────────

  /**
   * Get menu contributions, optionally filtered by group and when condition.
   */
  getMenus(group?: string, ctx?: WhenContext): MenuContribution[] {
    const result: MenuContribution[] = [];
    for (const manifest of this.manifests.values()) {
      const menus = manifest.contributes?.menus;
      if (!menus) continue;
      for (const menu of menus) {
        if (group !== undefined && menu.group !== group) continue;
        if (ctx === undefined || evaluateWhen(menu.when, ctx)) {
          result.push(menu);
        }
      }
    }
    return result;
  }

  // ─── Configuration Contributions ───────────────────────────

  /**
   * Get configuration schemas from all extensions.
   * Returns an array of { extensionId, title, schema } objects.
   */
  getConfigSchemas(): { extensionId: string; title: string; schema: Record<string, unknown> }[] {
    const result: { extensionId: string; title: string; schema: Record<string, unknown> }[] = [];
    for (const [id, manifest] of this.manifests) {
      const config = manifest.contributes?.configuration;
      if (config) {
        result.push({ extensionId: id, title: manifest.displayName, schema: config });
      }
    }
    return result;
  }

  // ─── Language Contributions ────────────────────────────────

  /**
   * Get all language contributions from extensions.
   */
  getLanguages(): { id: string; extensions: string[]; icon?: string }[] {
    const result: { id: string; extensions: string[]; icon?: string }[] = [];
    for (const manifest of this.manifests.values()) {
      const langs = manifest.contributes?.languages;
      if (!langs) continue;
      result.push(...langs);
    }
    return result;
  }

  // ─── Notification Contributions ──────────────────────────

  /**
   * Get all notification scenarios from extensions.
   * Each entry is tagged with the extension's display name as source.
   */
  getNotificationScenarios(): (NotificationContribution & { source: string })[] {
    const result: (NotificationContribution & { source: string })[] = [];
    for (const [extId, manifest] of this.manifests) {
      const notifs = manifest.contributes?.notifications;
      if (!notifs) continue;
      for (const n of notifs) {
        result.push({ ...n, source: manifest.displayName });
      }
    }
    return result;
  }

  // ─── Serialization ─────────────────────────────────────────

  /**
   * Serialize all contributions for sending to WebSocket clients.
   */
  toJSON(): Record<string, unknown> {
    return {
      extensions: this.listExtensions(),
      adapterViews: this.getAdapterViews(),
      views: {
        'sidebar-left': this.getViews('sidebar-left'),
        'sidebar-right': this.getViews('sidebar-right'),
      },
      commands: this.getCommands(),
      menus: this.getMenus(),
      configurations: this.getConfigSchemas(),
      languages: this.getLanguages(),
      notifications: this.getNotificationScenarios(),
    };
  }
}

/** Global singleton. */
export const extensionPoints = new ExtensionPointsRegistry();
