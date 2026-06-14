/**
 * Minimal FreeMarker-style template expander for Polygon test scripts.
 *
 * Supported subset (covers the common "generate many tests" use cases):
 *   - <#list a..b as i> ... </#list>   numeric ranges, may be nested
 *   - <#assign name = expr>            integer variable assignment
 *   - ${ expr }                        interpolation of an integer expression
 *   - <#-- comment -->                 comments (stripped)
 * Expressions: integers, variables, + - * / % and parentheses.
 *
 * Everything else is treated as literal text. Output is intended to be split
 * into lines, each line becoming one generator command (`gen arg1 arg2 ...`).
 */

const MAX_OUTPUT_LINES = 20000;

type Node =
  | { t: 'text'; v: string }
  | { t: 'interp'; v: string }
  | { t: 'assign'; name: string; expr: string }
  | { t: 'list'; from: string; to: string; var: string; body: Node[] };

// ---- expression evaluation (integers only) -------------------------------
function evalExpr(src: string, vars: Record<string, number>): number {
  let i = 0;
  const s = src;
  function skip() { while (i < s.length && /\s/.test(s[i])) i++; }
  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      skip();
      const c = s[i];
      if (c === '+') { i++; v += parseTerm(); }
      else if (c === '-') { i++; v -= parseTerm(); }
      else break;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    for (;;) {
      skip();
      const c = s[i];
      if (c === '*') { i++; v *= parseFactor(); }
      else if (c === '/') { i++; v = Math.trunc(v / parseFactor()); }
      else if (c === '%') { i++; v %= parseFactor(); }
      else break;
    }
    return v;
  }
  function parseFactor(): number {
    skip();
    if (s[i] === '(') { i++; const v = parseExpr(); skip(); if (s[i] === ')') i++; return v; }
    if (s[i] === '-') { i++; return -parseFactor(); }
    if (s[i] === '+') { i++; return parseFactor(); }
    const m = /^[0-9]+/.exec(s.slice(i));
    if (m) { i += m[0].length; return parseInt(m[0], 10); }
    const id = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(s.slice(i));
    if (id) {
      i += id[0].length;
      if (!(id[0] in vars)) throw new Error(`Unknown variable '${id[0]}'`);
      return vars[id[0]];
    }
    throw new Error(`Cannot parse expression near '${s.slice(i)}'`);
  }
  const result = parseExpr();
  skip();
  if (i < s.length) throw new Error(`Unexpected '${s.slice(i)}' in expression`);
  return result;
}

// ---- parsing -------------------------------------------------------------
function parse(tpl: string): Node[] {
  // strip comments first
  tpl = tpl.replace(/<#--[\s\S]*?-->/g, '');
  let pos = 0;

  function parseNodes(stopAtListEnd: boolean): Node[] {
    const nodes: Node[] = [];
    while (pos < tpl.length) {
      const next = tpl.indexOf('<', pos);
      const interp = tpl.indexOf('${', pos);
      // pick the earliest special marker
      const candidates = [next, interp].filter(x => x >= 0);
      const mark = candidates.length ? Math.min(...candidates) : -1;
      if (mark < 0) { nodes.push({ t: 'text', v: tpl.slice(pos) }); pos = tpl.length; break; }
      if (mark > pos) { nodes.push({ t: 'text', v: tpl.slice(pos, mark) }); pos = mark; }

      if (tpl.startsWith('${', pos)) {
        const end = tpl.indexOf('}', pos);
        if (end < 0) throw new Error('Unclosed ${...}');
        nodes.push({ t: 'interp', v: tpl.slice(pos + 2, end) });
        pos = end + 1;
        continue;
      }
      if (tpl.startsWith('</#list>', pos)) {
        if (!stopAtListEnd) throw new Error('Unexpected </#list>');
        pos += '</#list>'.length;
        return nodes;
      }
      const listM = /^<#list\s+([\s\S]*?)\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*>/.exec(tpl.slice(pos));
      if (listM) {
        const range = listM[1];
        const dots = range.indexOf('..');
        if (dots < 0) throw new Error(`<#list> needs a range a..b, got '${range}'`);
        pos += listM[0].length;
        const body = parseNodes(true);
        nodes.push({ t: 'list', from: range.slice(0, dots), to: range.slice(dots + 2), var: listM[2], body });
        continue;
      }
      const assignM = /^<#assign\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([\s\S]*?)\s*>/.exec(tpl.slice(pos));
      if (assignM) {
        nodes.push({ t: 'assign', name: assignM[1], expr: assignM[2] });
        pos += assignM[0].length;
        continue;
      }
      // a literal '<' that isn't a known directive
      nodes.push({ t: 'text', v: '<' });
      pos += 1;
    }
    if (stopAtListEnd) throw new Error('Unclosed <#list>');
    return nodes;
  }

  return parseNodes(false);
}

// ---- evaluation ----------------------------------------------------------
export function expandFreemarker(tpl: string): string {
  const ast = parse(tpl);
  const out: string[] = [];
  let emittedLines = 0;

  function render(nodes: Node[], vars: Record<string, number>): void {
    for (const n of nodes) {
      switch (n.t) {
        case 'text':
          out.push(n.v);
          emittedLines += (n.v.match(/\n/g) || []).length;
          break;
        case 'interp':
          out.push(String(evalExpr(n.v, vars)));
          break;
        case 'assign':
          vars[n.name] = evalExpr(n.expr, vars);
          break;
        case 'list': {
          const from = evalExpr(n.from, vars);
          const to = evalExpr(n.to, vars);
          for (let v = from; v <= to; v++) {
            if (emittedLines > MAX_OUTPUT_LINES) throw new Error(`Script expands to too many lines (> ${MAX_OUTPUT_LINES})`);
            render(n.body, { ...vars, [n.var]: v });
          }
          break;
        }
      }
    }
  }

  render(ast, {});
  return out.join('');
}

/** Expand a script and return the non-empty, trimmed command lines. */
export function expandScriptToLines(tpl: string): string[] {
  return expandFreemarker(tpl)
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'));
}
