/**
 * FreeMarker template renderer — a focused subset sufficient for Polygon's
 * statement templates (statements.ftl, problem.tex, tutorial.tex).
 *
 * Supported:
 *   <#-- comment -->
 *   ${ expr }
 *   <#assign name = expr>            (and self-closing <#assign .../>)
 *   <#if cond> .. <#elseif cond> .. <#else> .. </#if>
 *   <#list seq as item> .. </#list>
 * Expressions: string/number literals, dotted member access, + - * / %,
 *   comparisons (== = != < <= > >=), && || ! , the existence test `expr??`,
 *   the default operator `expr!default` / `expr!`, and built-ins
 *   ?c ?string ?size ?length.
 *
 * As in FreeMarker, a `>` meant as "greater than" inside a directive must be
 * parenthesised; the scanner finds the directive-closing `>` at paren depth 0.
 */

export const UNDEF = Symbol('ftl-undefined');
type Val = string | number | boolean | unknown[] | Record<string, unknown> | typeof UNDEF | null | undefined;

// ---------------------------------------------------------------- tokenizer
type Tok =
  | { k: 'text'; v: string }
  | { k: 'interp'; v: string }
  | { k: 'if'; v: string }
  | { k: 'elseif'; v: string }
  | { k: 'else' }
  | { k: 'endif' }
  | { k: 'list'; seq: string; var: string }
  | { k: 'endlist' }
  | { k: 'assign'; name: string; expr: string };

function findTagEnd(s: string, start: number): number {
  // start points just after "<#..." name; scan to the '>' at paren depth 0,
  // ignoring '>' inside parentheses or double-quoted strings.
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '>' && depth <= 0) return i;
  }
  throw new Error('Unterminated FreeMarker directive');
}

// Find the '>' that closes a directive starting at `from`, honouring
// parentheses and strings so a `>` used as "greater than" inside the directive
// is not mistaken for the closer.
function findGt(line: string, from: number): number {
  let depth = 0, inStr = false;
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (inStr) { if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '>' && depth <= 0) return i;
  }
  return -1;
}

// Split a single line into its directive tags and the remaining text.
function splitLineDirectives(line: string): { dirs: string; rest: string } {
  let i = 0, dirs = '', rest = '';
  while (i < line.length) {
    if (line.startsWith('</#', i)) {
      const e = line.indexOf('>', i + 3);
      if (e < 0) { rest += line.slice(i); break; }
      dirs += line.slice(i, e + 1); i = e + 1;
    } else if (line.startsWith('<#', i)) {
      const e = findGt(line, i + 2);
      if (e < 0) { rest += line.slice(i); break; }
      dirs += line.slice(i, e + 1); i = e + 1;
    } else { rest += line[i]; i++; }
  }
  return { dirs, rest };
}

// FreeMarker-style whitespace stripping: a source line that contains only FTL
// directives (and whitespace) is removed entirely — its indentation and line
// break are dropped. This avoids stray blank lines (e.g. inside LaTeX example
// tabulars, where an \obeylines \par would spawn a phantom row). Comments must
// already be removed before calling this.
function stripDirectiveWhitespace(src: string): string {
  const lines = src.split('\n');
  let out = '';
  for (let k = 0; k < lines.length; k++) {
    const { dirs, rest } = splitLineDirectives(lines[k]);
    if (dirs.length > 0 && rest.trim() === '') {
      out += dirs; // directive-only line: keep tags, drop whitespace + newline
    } else {
      out += lines[k] + (k < lines.length - 1 ? '\n' : '');
    }
  }
  return out;
}

function tokenize(tpl: string): Tok[] {
  const src = stripDirectiveWhitespace(tpl.replace(/<#--[\s\S]*?-->/g, ''));
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const dollar = src.indexOf('${', i);
    const close = src.indexOf('</#', i);
    const open = src.indexOf('<#', i);
    const cands = [dollar, close, open].filter(x => x >= 0);
    const next = cands.length ? Math.min(...cands) : -1;
    if (next < 0) { toks.push({ k: 'text', v: src.slice(i) }); break; }
    if (next > i) toks.push({ k: 'text', v: src.slice(i, next) });

    if (next === dollar) {
      const end = src.indexOf('}', next + 2);
      if (end < 0) throw new Error('Unterminated ${...}');
      toks.push({ k: 'interp', v: src.slice(next + 2, end).trim() });
      i = end + 1;
    } else if (next === close) {
      const end = src.indexOf('>', next + 3);
      const name = src.slice(next + 3, end).trim();
      toks.push({ k: name === 'list' ? 'endlist' : 'endif' });
      i = end + 1;
    } else {
      // <# directive
      const nameMatch = /^<#([a-zA-Z]+)/.exec(src.slice(next));
      if (!nameMatch) { toks.push({ k: 'text', v: '<#' }); i = next + 2; continue; }
      const kw = nameMatch[1];
      const end = findTagEnd(src, next + nameMatch[0].length);
      let body = src.slice(next + nameMatch[0].length, end).trim();
      if (body.endsWith('/')) body = body.slice(0, -1).trim(); // self-closing
      if (kw === 'if') toks.push({ k: 'if', v: body });
      else if (kw === 'elseif') toks.push({ k: 'elseif', v: body });
      else if (kw === 'else') toks.push({ k: 'else' });
      else if (kw === 'list') {
        const m = /^([\s\S]+?)\s+as\s+([a-zA-Z_]\w*)$/.exec(body);
        if (!m) throw new Error(`Bad <#list>: ${body}`);
        toks.push({ k: 'list', seq: m[1].trim(), var: m[2] });
      } else if (kw === 'assign') {
        const m = /^([a-zA-Z_]\w*)\s*=([\s\S]*)$/.exec(body);
        if (!m) throw new Error(`Bad <#assign>: ${body}`);
        toks.push({ k: 'assign', name: m[1], expr: m[2].trim() });
      } else {
        // Unknown directive — ignore.
      }
      i = end + 1;
    }
  }
  return toks;
}

// ------------------------------------------------------------------ AST
type Node =
  | { t: 'text'; v: string }
  | { t: 'interp'; v: string }
  | { t: 'assign'; name: string; expr: string }
  | { t: 'if'; branches: { cond: string; body: Node[] }[]; elseBody: Node[] | null }
  | { t: 'list'; seq: string; var: string; body: Node[] };

function parse(toks: Tok[]): Node[] {
  let p = 0;
  function parseSeq(stop: (t: Tok) => boolean): Node[] {
    const out: Node[] = [];
    while (p < toks.length && !stop(toks[p])) {
      const tok = toks[p];
      if (tok.k === 'text') { out.push({ t: 'text', v: tok.v }); p++; }
      else if (tok.k === 'interp') { out.push({ t: 'interp', v: tok.v }); p++; }
      else if (tok.k === 'assign') { out.push({ t: 'assign', name: tok.name, expr: tok.expr }); p++; }
      else if (tok.k === 'if') {
        p++;
        const branches: { cond: string; body: Node[] }[] = [{ cond: tok.v, body: parseSeq(t => t.k === 'elseif' || t.k === 'else' || t.k === 'endif') }];
        while (toks[p] && toks[p].k === 'elseif') {
          const c = (toks[p] as { v: string }).v; p++;
          branches.push({ cond: c, body: parseSeq(t => t.k === 'elseif' || t.k === 'else' || t.k === 'endif') });
        }
        let elseBody: Node[] | null = null;
        if (toks[p] && toks[p].k === 'else') { p++; elseBody = parseSeq(t => t.k === 'endif'); }
        if (toks[p] && toks[p].k === 'endif') p++;
        out.push({ t: 'if', branches, elseBody });
      } else if (tok.k === 'list') {
        p++;
        const body = parseSeq(t => t.k === 'endlist');
        if (toks[p] && toks[p].k === 'endlist') p++;
        out.push({ t: 'list', seq: tok.seq, var: tok.var, body });
      } else { p++; }
    }
    return out;
  }
  return parseSeq(() => false);
}

// ------------------------------------------------------- expression engine
class ExprParser {
  private toks: string[];
  private pos = 0;
  constructor(src: string) { this.toks = ExprParser.lex(src); }

  static lex(s: string): string[] {
    const out: string[] = [];
    const re = /\s*(\?\?|==|!=|<=|>=|&&|\|\||"[^"]*"|[0-9]+(?:\.[0-9]+)?|[A-Za-z_]\w*|[.()?!,*/%+\-<>=])/y;
    let i = 0;
    while (i < s.length) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m) { if (/\s/.test(s[i])) { i++; continue; } throw new Error(`Bad token near '${s.slice(i)}'`); }
      out.push(m[1]);
      i = re.lastIndex;
    }
    return out;
  }

  private peek() { return this.toks[this.pos]; }
  private next() { return this.toks[this.pos++]; }

  parse(scope: Scope): Val { const v = this.or(scope); return v; }

  private or(s: Scope): Val {
    let v = this.and(s);
    while (this.peek() === '||') { this.next(); const r = this.and(s); v = toBool(v) || toBool(r); }
    return v;
  }
  private and(s: Scope): Val {
    let v = this.cmp(s);
    while (this.peek() === '&&') { this.next(); const r = this.cmp(s); v = toBool(v) && toBool(r); }
    return v;
  }
  private cmp(s: Scope): Val {
    let v = this.add(s);
    while (['==', '=', '!=', '<', '<=', '>', '>='].includes(this.peek())) {
      const op = this.next(); const r = this.add(s);
      v = compare(op, v, r);
    }
    return v;
  }
  private add(s: Scope): Val {
    let v = this.mul(s);
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.next(); const r = this.mul(s);
      v = op === '+' ? (num(v) + num(r)) : (num(v) - num(r));
    }
    return v;
  }
  private mul(s: Scope): Val {
    let v = this.unary(s);
    while (['*', '/', '%'].includes(this.peek())) {
      const op = this.next(); const r = this.unary(s);
      v = op === '*' ? num(v) * num(r) : op === '/' ? num(v) / num(r) : num(v) % num(r);
    }
    return v;
  }
  private unary(s: Scope): Val {
    if (this.peek() === '!') { this.next(); return !toBool(this.unary(s)); }
    if (this.peek() === '-') { this.next(); return -num(this.unary(s)); }
    return this.postfix(s);
  }
  private postfix(s: Scope): Val {
    let v = this.primary(s);
    for (;;) {
      const t = this.peek();
      if (t === '.') { this.next(); const name = this.next(); v = member(v, name); }
      else if (t === '??') { this.next(); v = v !== UNDEF && v !== null && v !== undefined; }
      else if (t === '?') { this.next(); const bi = this.next(); v = builtin(bi, v); }
      else if (t === '!') {
        this.next();
        const nt = this.peek();
        let def: Val = '';
        if (nt !== undefined && (/^["0-9A-Za-z_(]/.test(nt))) def = this.postfix(s);
        v = (v === UNDEF || v === null || v === undefined) ? def : v;
      } else break;
    }
    return v;
  }
  private primary(s: Scope): Val {
    const t = this.next();
    if (t === undefined) return UNDEF;
    if (t === '(') { const v = this.or(s); if (this.peek() === ')') this.next(); return v; }
    if (t[0] === '"') return t.slice(1, -1);
    if (/^[0-9]/.test(t)) return parseFloat(t);
    if (t === 'true') return true;
    if (t === 'false') return false;
    return s.get(t);
  }
}

// ------------------------------------------------------------- value helpers
function num(v: Val): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return NaN;
}
function toBool(v: Val): boolean {
  if (typeof v === 'boolean') return v;
  if (v === UNDEF || v === null || v === undefined) return false;
  return Boolean(v);
}
function eq(a: Val, b: Val): boolean {
  if (typeof a === 'number' || typeof b === 'number') return num(a) === num(b);
  return a === b;
}
function compare(op: string, a: Val, b: Val): boolean {
  switch (op) {
    case '==': case '=': return eq(a, b);
    case '!=': return !eq(a, b);
    case '<': return num(a) < num(b);
    case '<=': return num(a) <= num(b);
    case '>': return num(a) > num(b);
    case '>=': return num(a) >= num(b);
  }
  return false;
}
function member(obj: Val, name: string): Val {
  if (obj === UNDEF || obj === null || obj === undefined || typeof obj !== 'object') return UNDEF;
  const v = (obj as Record<string, unknown>)[name];
  return (v === undefined ? UNDEF : v as Val);
}
function builtin(name: string, v: Val): Val {
  switch (name) {
    case 'c': return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v ?? '');
    case 'string': return v === UNDEF || v === null || v === undefined ? '' : String(v);
    case 'size': return Array.isArray(v) ? v.length : 0;
    case 'length': return typeof v === 'string' ? v.length : 0;
  }
  throw new Error(`Unknown built-in ?${name}`);
}

// ------------------------------------------------------------------- scope
class Scope {
  constructor(private vars: Record<string, unknown>, private parent?: Scope) {}
  get(name: string): Val {
    if (name in this.vars) return this.vars[name] as Val;
    if (this.parent) return this.parent.get(name);
    return UNDEF;
  }
  set(name: string, v: Val) { this.vars[name] = v; }
  child(extra: Record<string, unknown>): Scope { return new Scope(extra, this); }
}

function evalExpr(src: string, scope: Scope): Val {
  return new ExprParser(src).parse(scope);
}

function stringify(v: Val): string {
  if (v === UNDEF || v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v);
}

function render(nodes: Node[], scope: Scope, out: string[]): void {
  for (const n of nodes) {
    switch (n.t) {
      case 'text': out.push(n.v); break;
      case 'interp': out.push(stringify(evalExpr(n.v, scope))); break;
      case 'assign': scope.set(n.name, evalExpr(n.expr, scope)); break;
      case 'if': {
        let done = false;
        for (const b of n.branches) {
          if (toBool(evalExpr(b.cond, scope))) { render(b.body, scope, out); done = true; break; }
        }
        if (!done && n.elseBody) render(n.elseBody, scope, out);
        break;
      }
      case 'list': {
        const seq = evalExpr(n.seq, scope);
        if (Array.isArray(seq)) {
          for (const item of seq) render(n.body, scope.child({ [n.var]: item }), out);
        }
        break;
      }
    }
  }
}

export function renderFtl(template: string, root: Record<string, unknown>): string {
  const ast = parse(tokenize(template));
  const out: string[] = [];
  render(ast, new Scope(root), out);
  return out.join('');
}
