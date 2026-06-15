import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { getProblemDir, getContestDir } from '../db/schema';
import { getProblem, getStatement, getTestset, listTests } from './problems';
import { renderFtl } from './ftl';

const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates', 'statements');

export interface CompileResult { ok: boolean; log: string; pdfPath?: string; }

// pdflatex + inputenc(utf8) only knows a limited set of Unicode characters.
// Authors routinely paste "fancy" punctuation/operators (a real minus sign,
// ≤, ≥, ×, non-breaking spaces, …) which otherwise abort the compile with
// "Unicode character ... not set up for use with LaTeX". We declare fallbacks
// for the common offenders; \ensuremath keeps math operators valid in both
// text and math mode. Injected right after \usepackage[utf8]{inputenc}.
const UNICODE_FIXES = [
  '% --- auto-injected Unicode fallbacks (lite-polygon) ---',
  '\\DeclareUnicodeCharacter{2212}{\\ensuremath{-}}',   // − minus sign
  '\\DeclareUnicodeCharacter{2264}{\\ensuremath{\\le}}',  // ≤
  '\\DeclareUnicodeCharacter{2265}{\\ensuremath{\\ge}}',  // ≥
  '\\DeclareUnicodeCharacter{2260}{\\ensuremath{\\ne}}',  // ≠
  '\\DeclareUnicodeCharacter{2248}{\\ensuremath{\\approx}}', // ≈
  '\\DeclareUnicodeCharacter{00D7}{\\ensuremath{\\times}}',  // ×
  '\\DeclareUnicodeCharacter{00B7}{\\ensuremath{\\cdot}}',   // ·
  '\\DeclareUnicodeCharacter{2022}{\\ensuremath{\\bullet}}', // •
  '\\DeclareUnicodeCharacter{2208}{\\ensuremath{\\in}}',     // ∈
  '\\DeclareUnicodeCharacter{2209}{\\ensuremath{\\notin}}',  // ∉
  '\\DeclareUnicodeCharacter{2211}{\\ensuremath{\\sum}}',    // ∑
  '\\DeclareUnicodeCharacter{221A}{\\ensuremath{\\sqrt{}}}', // √
  '\\DeclareUnicodeCharacter{221E}{\\ensuremath{\\infty}}',  // ∞
  '\\DeclareUnicodeCharacter{2192}{\\ensuremath{\\to}}',     // →
  '\\DeclareUnicodeCharacter{21D2}{\\ensuremath{\\Rightarrow}}', // ⇒
  '\\DeclareUnicodeCharacter{2026}{\\ldots}',          // …
  '\\DeclareUnicodeCharacter{2013}{--}',               // – en dash
  '\\DeclareUnicodeCharacter{2014}{---}',              // — em dash
  '\\DeclareUnicodeCharacter{00A0}{~}',                // non-breaking space
  '\\DeclareUnicodeCharacter{2009}{\\,}',              // thin space
  '\\DeclareUnicodeCharacter{202F}{\\,}',              // narrow nbsp
  '\\DeclareUnicodeCharacter{2018}{`}',                // ‘
  '\\DeclareUnicodeCharacter{2019}{\'}',               // ’
  '\\DeclareUnicodeCharacter{201C}{``}',               // “
  '\\DeclareUnicodeCharacter{201D}{\'\'}',             // ”
  '\\DeclareUnicodeCharacter{2032}{\\ensuremath{{}^\\prime}}', // ′
].join('\n');

function injectUnicodeFixes(mainTex: string): string {
  return mainTex.replace(/(\\usepackage\s*\[utf8\]\s*\{inputenc\})/, `$1\n${UNICODE_FIXES}`);
}

function spawnPdflatex(cwd: string, file: string): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const p = spawn('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', file], {
      cwd,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: os.tmpdir(),
        TEXMFVAR: path.join(os.tmpdir(), 'texmf-var'),
      },
    });
    p.on('error', () => resolve({ code: -1 }));
    p.on('close', (code) => resolve({ code }));
    // Drain output so the process is not blocked on a full pipe buffer.
    p.stdout?.on('data', () => {});
    p.stderr?.on('data', () => {});
  });
}

/** Build the LaTeX data model for one statement from the stored problem data. */
function buildModel(problemId: number, lang: string) {
  const problem = getProblem(problemId);
  if (!problem) throw new Error('Problem not found');
  const stmt = getStatement(problemId, lang) as Record<string, unknown> | undefined;
  if (!stmt) throw new Error(`No statement for language "${lang}"`);

  const sampleTests: { inputFile: string; outputFile: string }[] = [];
  const exampleFiles: { name: string; content: string }[] = [];
  let maxExampleLineLen = 0;
  const testset = getTestset(problemId, 'tests');
  if (testset) {
    const problemDir = getProblemDir(problemId);
    const samples = listTests(testset.id).filter(t => t.sample);
    samples.forEach((t, k) => {
      const nn = String(t.idx).padStart(2, '0');
      const inPath = path.join(problemDir, testset.input_path_pattern.replace('%02d', nn));
      const ansPath = path.join(problemDir, testset.answer_path_pattern.replace('%02d', nn));
      const inName = `example_${k + 1}_in`;
      const outName = `example_${k + 1}_out`;
      // Cap example size so a giant sample cannot blow up the PDF.
      const read = (p: string) => fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').slice(0, 20000) : '';
      const inContent = read(inPath);
      const outContent = read(ansPath);
      for (const line of `${inContent}\n${outContent}`.split('\n')) {
        if (line.length > maxExampleLineLen) maxExampleLineLen = line.length;
      }
      exampleFiles.push({ name: inName, content: inContent });
      exampleFiles.push({ name: outName, content: outContent });
      sampleTests.push({ inputFile: inName, outputFile: outName });
    });
  }

  const model = {
    language: lang,
    problem: {
      name: (stmt.name as string) || problem.short_name,
      inputFile: problem.input_file || 'stdin',
      outputFile: problem.output_file || 'stdout',
      timeLimit: problem.time_limit || 1000,
      memoryLimit: problem.memory_limit || 268435456,
      legend: (stmt.legend as string) || '',
      input: (stmt.input_section as string) || '',
      output: (stmt.output_section as string) || '',
      interaction: (stmt.interaction as string) || '',
      scoring: (stmt.scoring as string) || '',
      notes: (stmt.notes as string) || '',
      tutorial: (stmt.tutorial as string) || '',
      sampleTests,
    },
  };
  return { model, exampleFiles, maxExampleLineLen };
}

// The side-by-side example column fits roughly this many monospace characters
// on A4; longer sample lines overflow it, so we stack input above output.
const SIDE_BY_SIDE_MAX_COLS = 30;

const CONTEST_TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates', 'contest');

/**
 * Render one problem's LaTeX body (statement + tutorial) from the Polygon
 * problem.tex / tutorial.tex templates, applying the wide-example layout switch.
 * Returns the rendered tex and the sample-example files it references. Throws if
 * the problem has no statement for `lang`.
 */
export function renderProblemBody(problemId: number, lang: string): {
  statementTex: string; tutorialTex: string; exampleFiles: { name: string; content: string }[];
} {
  const { model, exampleFiles, maxExampleLineLen } = buildModel(problemId, lang);
  const problemTpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'problem.tex'), 'utf-8');
  const tutorialTpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'tutorial.tex'), 'utf-8');

  let statementTex = renderFtl(problemTpl, model);
  // If any sample line is too wide for the side-by-side columns, switch to the
  // stacked layout (input above output) so examples don't run off the page.
  if (maxExampleLineLen > SIDE_BY_SIDE_MAX_COLS) {
    statementTex = statementTex
      .replace(/\\begin\{example\}/g, '\\begin{examplewide}')
      .replace(/\\end\{example\}/g, '\\end{examplewide}');
  }
  const tutorialTex = renderFtl(tutorialTpl, model);
  return { statementTex, tutorialTex, exampleFiles };
}

/**
 * Render the Polygon statement templates for one problem/language and compile
 * them to PDF with pdflatex. The PDF is written to
 * `<problemDir>/statements/<lang>/statement.pdf`. Returns the compile log so
 * callers can surface LaTeX errors.
 */
export async function compileStatementPdf(problemId: number, lang: string): Promise<CompileResult> {
  const { statementTex, exampleFiles } = renderProblemBody(problemId, lang);
  const statementsTpl = fs.readFileSync(path.join(TEMPLATES_DIR, 'statements.ftl'), 'utf-8');

  const mainTex = injectUnicodeFixes(renderFtl(statementsTpl, {
    contest: { name: '', location: '', date: '', language: lang },
    statements: [{ file: 'statement.tex' }],
  }));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ltex-'));
  try {
    fs.writeFileSync(path.join(tmp, 'statement.tex'), statementTex, 'utf-8');
    fs.writeFileSync(path.join(tmp, 'statements.tex'), mainTex, 'utf-8');
    fs.copyFileSync(path.join(TEMPLATES_DIR, 'olymp.sty'), path.join(tmp, 'olymp.sty'));
    for (const ex of exampleFiles) fs.writeFileSync(path.join(tmp, ex.name), ex.content, 'utf-8');

    // Two passes so \lastpage / section references resolve.
    await spawnPdflatex(tmp, 'statements.tex');
    const second = await spawnPdflatex(tmp, 'statements.tex');

    const logPath = path.join(tmp, 'statements.log');
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '(no log produced)';
    const builtPdf = path.join(tmp, 'statements.pdf');

    if (second.code === -1) {
      return { ok: false, log: 'pdflatex is not installed or failed to start.' };
    }
    if (!fs.existsSync(builtPdf)) {
      return { ok: false, log: extractErrors(log) };
    }

    const outDir = path.join(getProblemDir(problemId), 'statements', lang);
    fs.mkdirSync(outDir, { recursive: true });
    const pdfPath = path.join(outDir, 'statement.pdf');
    fs.copyFileSync(builtPdf, pdfPath);
    // Keep the rendered .tex next to the PDF for debugging/transparency.
    fs.writeFileSync(path.join(outDir, 'statement.tex'), statementTex, 'utf-8');
    return { ok: true, log: extractErrors(log), pdfPath };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function statementPdfPath(problemId: number, lang: string): string {
  return path.join(getProblemDir(problemId), 'statements', lang, 'statement.pdf');
}

export function contestPdfPath(contestId: number, kind: 'statements' | 'tutorials', lang: string): string {
  return path.join(getContestDir(contestId), `${kind}-${lang}.pdf`);
}

/**
 * Compile a combined contest PDF (all problems with A, B, C… indices) for the
 * given kind ('statements' or 'tutorials') and language, using the contest
 * templates. Each problem is rendered into its own subdir and \import-ed by the
 * contest template. Returns the compile log.
 */
export async function compileContest(
  contest: { id: number; name: string; location: string; date: string; language: string },
  problems: { problemId: number; index: string }[],
  kind: 'statements' | 'tutorials',
  lang: string,
): Promise<CompileResult> {
  const tpl = fs.readFileSync(path.join(CONTEST_TEMPLATES_DIR, `${kind}.ftl`), 'utf-8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lctex-'));
  const warnings: string[] = [];

  try {
    fs.copyFileSync(path.join(CONTEST_TEMPLATES_DIR, 'olymp.sty'), path.join(tmp, 'olymp.sty'));

    const items: { path: string; file: string; index: string }[] = [];
    for (const p of problems) {
      let body: ReturnType<typeof renderProblemBody>;
      try { body = renderProblemBody(p.problemId, lang); }
      catch (e: unknown) { warnings.push(`Problem ${p.index}: ${(e as Error).message}`); continue; }

      const tex = kind === 'statements' ? body.statementTex : body.tutorialTex;
      if (kind === 'tutorials' && !tex.replace(/\\begin\{tutorial\}[\s\S]*?\}/, '').replace(/\\end\{tutorial\}/, '').trim()) {
        continue; // problem has no tutorial text — skip it from the combined tutorial
      }

      const sub = `prob_${p.index}`;
      fs.mkdirSync(path.join(tmp, sub), { recursive: true });
      const fileName = `${kind === 'statements' ? 'statement' : 'tutorial'}.tex`;
      fs.writeFileSync(path.join(tmp, sub, fileName), tex, 'utf-8');
      // Example files live next to the statement so \exmpfile/\verbatiminput find them.
      if (kind === 'statements') {
        for (const ex of body.exampleFiles) fs.writeFileSync(path.join(tmp, sub, ex.name), ex.content, 'utf-8');
      }
      items.push({ path: `${sub}/`, file: fileName, index: p.index });
    }

    if (items.length === 0) {
      return { ok: false, log: `No ${kind} to compile for language "${lang}".${warnings.length ? '\n' + warnings.join('\n') : ''}` };
    }

    const model: Record<string, unknown> = {
      contest: { name: contest.name, location: contest.location, date: contest.date, language: contest.language || lang },
      shortProblemTitle: false,
    };
    model[kind] = items; // `statements` or `tutorials`
    const mainTex = injectUnicodeFixes(renderFtl(tpl, model));
    fs.writeFileSync(path.join(tmp, `${kind}.tex`), mainTex, 'utf-8');

    await spawnPdflatex(tmp, `${kind}.tex`);
    const second = await spawnPdflatex(tmp, `${kind}.tex`);

    const logPath = path.join(tmp, `${kind}.log`);
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '(no log produced)';
    const builtPdf = path.join(tmp, `${kind}.pdf`);
    if (second.code === -1) return { ok: false, log: 'pdflatex is not installed or failed to start.' };
    if (!fs.existsSync(builtPdf)) return { ok: false, log: [extractErrors(log), ...warnings].join('\n') };

    const outDir = getContestDir(contest.id);
    fs.mkdirSync(outDir, { recursive: true });
    const pdfPath = contestPdfPath(contest.id, kind, lang);
    fs.copyFileSync(builtPdf, pdfPath);
    return { ok: true, log: [extractErrors(log), ...warnings].join('\n').trim(), pdfPath };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Pull the meaningful lines out of a LaTeX log for display. */
function extractErrors(log: string): string {
  const lines = log.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('!') || /^l\.\d+/.test(l) || /Warning:/.test(l) || /not found/.test(l)) {
      out.push(l);
      if (lines[i + 1]) out.push(lines[i + 1]);
    }
  }
  return (out.join('\n').trim() || 'Compiled successfully').slice(0, 4000);
}
