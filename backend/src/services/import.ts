import fs from 'fs';
import path from 'path';
import unzipper from 'unzipper';
import { parseProblemXml } from '../polygon-xml/parser';
import { db, getProblemDir } from '../db/schema';
import {
  createProblem, updateProblem, upsertProblemName, upsertStatement,
  upsertSolution, upsertAsset, setTags, getOrCreateTestset, upsertTest,
  upsertTestGroup, upsertCheckerTest, upsertValidatorTest, upsertFile,
  setProperty,
} from './problems';
import type { ProblemXmlModel } from '../polygon-xml/types';

interface ImportResult {
  problemId: number;
  shortName: string;
  warnings: string[];
  errors: string[];
  filesImported: number;
  testsImported: number;
}

// Recursively copy src → dest, skipping symlinks to avoid zip-slip.
// Returns the number of regular files copied.
function copyDirSync(src: string, dest: string, warnings: string[]): number {
  let count = 0;
  const createdDirs = new Set<string>();

  function walk(s: string, d: string) {
    for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symlink: ${entry.name}`);
        continue;
      }
      const sp = path.join(s, entry.name);
      const dp = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!createdDirs.has(dp)) { fs.mkdirSync(dp, { recursive: true }); createdDirs.add(dp); }
        walk(sp, dp);
      } else if (entry.isFile()) {
        fs.copyFileSync(sp, dp);
        count++;
      }
    }
  }

  fs.mkdirSync(dest, { recursive: true });
  walk(src, dest);
  return count;
}

export async function importPackage(
  zipPath: string,
  ownerId: number,
  overwriteExisting = false
): Promise<ImportResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  let filesImported = 0;

  const MAX_ZIP_SIZE = 500 * 1024 * 1024;
  if (fs.statSync(zipPath).size > MAX_ZIP_SIZE) throw new Error(`Zip too large: ${fs.statSync(zipPath).size} bytes`);

  // Stream-extract to a temp dir — no full in-memory load of the ZIP.
  const tmpDir = `/tmp/extract_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    await fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: tmpDir }))
      .promise();

    // Find problem.xml — at root or one level deep (e.g. inside "rombuses-59/").
    let prefix = '';
    let xmlFile = path.join(tmpDir, 'problem.xml');
    if (!fs.existsSync(xmlFile)) {
      const subs = fs.readdirSync(tmpDir, { withFileTypes: true }).filter(e => e.isDirectory());
      for (const sub of subs) {
        const candidate = path.join(tmpDir, sub.name, 'problem.xml');
        if (fs.existsSync(candidate)) { xmlFile = candidate; prefix = sub.name; break; }
      }
    }
    if (!fs.existsSync(xmlFile)) throw new Error('problem.xml not found in zip');

    const xmlContent = fs.readFileSync(xmlFile, 'utf-8');
    const model = parseProblemXml(xmlContent);
    const shortName = model.shortName || `problem_${Date.now()}`;

    // Resolve or create problem record.
    let problemId: number;
    const existing = db.prepare('SELECT id FROM problems WHERE owner_id = ? AND short_name = ?')
      .get(ownerId, shortName) as { id: number } | undefined;

    if (existing && !overwriteExisting) {
      throw new Error(`Problem '${shortName}' already exists. Use overwrite=true to replace.`);
    }

    if (existing) {
      problemId = existing.id;
      const problemDir = getProblemDir(problemId);
      if (fs.existsSync(problemDir)) fs.rmSync(problemDir, { recursive: true, force: true });
      // Clear all related DB rows for a clean re-import.
      const testsets = db.prepare('SELECT id FROM testsets WHERE problem_id = ?').all(problemId) as { id: number }[];
      for (const ts of testsets) {
        db.prepare('DELETE FROM tests WHERE testset_id = ?').run(ts.id);
        db.prepare('DELETE FROM test_groups WHERE testset_id = ?').run(ts.id);
      }
      db.prepare('DELETE FROM testsets WHERE problem_id = ?').run(problemId);
      db.prepare('DELETE FROM problem_names WHERE problem_id = ?').run(problemId);
      db.prepare('DELETE FROM statements WHERE problem_id = ?').run(problemId);
      db.prepare('DELETE FROM solutions WHERE problem_id = ?').run(problemId);
      db.prepare('DELETE FROM assets WHERE problem_id = ?').run(problemId);
      db.prepare('DELETE FROM problem_files WHERE problem_id = ?').run(problemId);
      db.prepare('DELETE FROM executables WHERE problem_id = ?').run(problemId);
      db.prepare('DELETE FROM checker_tests WHERE problem_id = ?').run(problemId);
      db.prepare('DELETE FROM validator_tests WHERE problem_id = ?').run(problemId);
      db.prepare('DELETE FROM problem_properties WHERE problem_id = ?').run(problemId);
      db.prepare('DELETE FROM problem_tags WHERE problem_id = ?').run(problemId);
    } else {
      const problem = createProblem(ownerId, shortName);
      problemId = problem.id;
    }

    const problemDir = getProblemDir(problemId);
    fs.mkdirSync(problemDir, { recursive: true });

    // Copy extracted files to problemDir.
    const srcBase = prefix ? path.join(tmpDir, prefix) : tmpDir;
    filesImported = copyDirSync(srcBase, problemDir, warnings);

    // All metadata DB inserts in ONE transaction — avoids per-insert fsync overhead.
    // For a package with 50 tests this can be 10-100× faster than individual commits.
    let testsImported = 0;

    db.transaction(() => {
      const judging = model.judging;
      updateProblem(problemId, {
        revision: parseInt(model.revision) || 1,
        time_limit: judging.testsets[0]?.timeLimit ?? 1000,
        memory_limit: judging.testsets[0]?.memoryLimit ?? 268435456,
        input_file: judging.inputFile,
        output_file: judging.outputFile,
        run_count: judging.runCount,
        cpu_name: judging.cpuName ?? '',
        cpu_speed: judging.cpuSpeed ?? '',
        polygon_url: model.url ?? '',
        modified: 0,
      });

      for (const n of model.names) {
        upsertProblemName(problemId, n.language, n.value);
      }

      // Testsets, tests, groups.
      for (const ts of model.judging.testsets) {
        const testset = getOrCreateTestset(problemId, ts.name);
        db.prepare('UPDATE testsets SET time_limit=?, memory_limit=?, input_path_pattern=?, answer_path_pattern=? WHERE id=?')
          .run(ts.timeLimit, ts.memoryLimit, ts.inputPathPattern, ts.answerPathPattern, testset.id);
        for (let i = 0; i < ts.tests.length; i++) {
          const t = ts.tests[i];
          upsertTest(testset.id, i + 1, {
            method: t.method,
            cmd: t.cmd ?? '',
            description: t.description ?? '',
            sample: t.sample ? 1 : 0,
            group_name: t.group ?? '',
            points: t.points ?? 0,
            extra_attrs: JSON.stringify(t._extraAttrs ?? {}),
          });
          testsImported++;
        }
        for (const g of ts.groups) {
          upsertTestGroup(testset.id, g.name, {
            points: g.points ?? 0,
            pointsPolicy: g.pointsPolicy,
            feedbackPolicy: g.feedbackPolicy,
            dependencies: g.dependencies,
          });
        }
        if (ts.groups.length > 0) {
          db.prepare('UPDATE testsets SET groups_enabled=1 WHERE id=?').run(testset.id);
        }
        if (ts.tests.some(t => (t.points ?? 0) > 0)) {
          db.prepare('UPDATE testsets SET points_enabled=1 WHERE id=?').run(testset.id);
        }
      }

      // Resource files and executables.
      for (const r of model.files.resources) {
        upsertFile(problemId, r.path, {
          file_role: 'resource', source_type: r.type ?? '',
          for_types: r.forTypes ?? '', stages: r.stages ?? '',
          assets_attr: r.assets ?? '', is_main: r.main === 'true' ? 1 : 0,
          extra_attrs: JSON.stringify(r._extraAttrs ?? {}),
        });
      }
      for (const e of model.files.executables) {
        if (e.source) upsertFile(problemId, e.source.path, { file_role: 'executable_source', source_type: e.source.type });
        if (e.binary) upsertFile(problemId, e.binary.path, { file_role: 'executable_binary', source_type: e.binary.type });
        if (e.source || e.binary) {
          db.prepare('INSERT INTO executables (problem_id, source_path, source_type, binary_path, binary_type) VALUES (?,?,?,?,?)')
            .run(problemId, e.source?.path ?? '', e.source?.type ?? '', e.binary?.path ?? '', e.binary?.type ?? '');
        }
      }

      // Checker.
      if (model.assets.checker) {
        const c = model.assets.checker;
        upsertAsset(problemId, 'checker', {
          name: c.name ?? '', checker_type: c.type ?? 'testlib',
          source_path: c.source?.path ?? '', source_type: c.source?.type ?? '',
          binary_path: c.binary?.path ?? '', binary_type: c.binary?.type ?? '',
          copy_path: c.copy?.path ?? '', copy_type: c.copy?.type ?? '',
        });
        if (c.testset?.tests) {
          for (let i = 0; i < c.testset.tests.length; i++) {
            upsertCheckerTest(problemId, i + 1, { expected_verdict: c.testset.tests[i].verdict ?? 'OK' });
          }
        }
      }

      // Validators.
      for (let vi = 0; vi < model.assets.validators.length; vi++) {
        const v = model.assets.validators[vi];
        if (vi === 0) {
          upsertAsset(problemId, 'validator', {
            source_path: v.source?.path ?? '', source_type: v.source?.type ?? '',
            binary_path: v.binary?.path ?? '', binary_type: v.binary?.type ?? '',
          });
        }
        if (v.testset?.tests) {
          for (let ti = 0; ti < v.testset.tests.length; ti++) {
            const vt = v.testset.tests[ti];
            const testFile = path.join(problemDir, v.testset.inputPathPattern.replace('%02d', String(ti + 1).padStart(2, '0')));
            const inputContent = fs.existsSync(testFile) ? fs.readFileSync(testFile, 'utf-8') : '';
            upsertValidatorTest(problemId, vi, ti + 1, {
              input: inputContent, expected_verdict: vt.verdict ?? 'VALID',
              testset_name: vt.testset ?? '', group_name: vt.group ?? '',
            });
          }
        }
      }

      // Interactor.
      if (model.assets.interactor) {
        const interactor = model.assets.interactor;
        upsertAsset(problemId, 'interactor', {
          source_path: interactor.source?.path ?? '', source_type: interactor.source?.type ?? '',
          binary_path: interactor.binary?.path ?? '', binary_type: interactor.binary?.type ?? '',
        });
        if (interactor.runs) {
          db.prepare('DELETE FROM interactor_runs WHERE problem_id=?').run(problemId);
          for (const r of interactor.runs) {
            db.prepare('INSERT INTO interactor_runs (problem_id, run_index) VALUES (?,?)').run(problemId, r);
          }
        }
        updateProblem(problemId, { interactive: 1 });
      }

      // Solutions.
      for (const s of model.assets.solutions) {
        upsertSolution(problemId, s.source?.path ?? s.binary?.path ?? '', {
          source_type: s.source?.type ?? '',
          binary_path: s.binary?.path ?? '', binary_type: s.binary?.type ?? '',
          tag: s.tag,
        });
      }

      // Statements.
      const langs = new Set<string>();
      for (const st of model.statements) langs.add(st.language);
      for (const tt of model.tutorials) langs.add(tt.language);

      for (const lang of langs) {
        const propsJson = path.join(problemDir, 'statements', lang, 'problem-properties.json');
        if (fs.existsSync(propsJson)) {
          try {
            const props = JSON.parse(fs.readFileSync(propsJson, 'utf-8'));
            upsertStatement(problemId, lang, {
              name: props.name ?? '', legend: props.legend ?? '',
              input_section: props.input ?? '', output_section: props.output ?? '',
              scoring: props.scoring ?? '', interaction: props.interaction ?? '',
              notes: props.notes ?? '', tutorial: props.tutorial ?? '',
            });
          } catch { warnings.push(`Failed to parse problem-properties.json for ${lang}`); }
        } else {
          const sec = path.join(problemDir, 'statement-sections', lang);
          const getSec = (name: string) => {
            const p = path.join(sec, `${name}.tex`);
            return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
          };
          upsertStatement(problemId, lang, {
            name: getSec('name'), legend: getSec('legend'),
            input_section: getSec('input'), output_section: getSec('output'),
            scoring: getSec('scoring'), interaction: getSec('interaction'),
            notes: getSec('notes'), tutorial: getSec('tutorial'),
          });
        }
        const nameTex = path.join(problemDir, 'statement-sections', lang, 'name.tex');
        if (fs.existsSync(nameTex)) {
          const nameContent = fs.readFileSync(nameTex, 'utf-8').trim();
          if (nameContent) upsertProblemName(problemId, lang, nameContent);
        }
      }

      // Model names override (may have already been set from statements above).
      for (const n of model.names) upsertProblemName(problemId, n.language, n.value);

      // Properties and tags.
      for (const p of model.properties) setProperty(problemId, p.name, p.value);
      setTags(problemId, model.tags);
    })();

    // Keep a copy of problem.xml for reference.
    fs.writeFileSync(path.join(problemDir, 'problem.xml'), xmlContent);

    return { problemId, shortName, warnings, errors, filesImported, testsImported };

  } finally {
    // Always remove the temp extraction dir.
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
