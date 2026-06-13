import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { parseProblemXml } from '../polygon-xml/parser';
import { db, getProblemDir } from '../db/schema';
import {
  createProblem, updateProblem, upsertProblemName, upsertStatement,
  upsertSolution, upsertAsset, setTags, getOrCreateTestset, upsertTest,
  upsertTestGroup, upsertCheckerTest, upsertValidatorTest, upsertFile,
  setProperty, listTests,
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

export async function importPackage(
  zipPath: string,
  ownerId: number,
  overwriteExisting = false
): Promise<ImportResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  let filesImported = 0;

  // Load zip entirely into memory once (AdmZip keeps decompressed data cached per-entry)
  const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500 MB
  const zipStat = fs.statSync(zipPath);
  if (zipStat.size > MAX_ZIP_SIZE) throw new Error(`Zip too large: ${zipStat.size} bytes`);

  const zip = new AdmZip(zipPath);
  const zipEntries = zip.getEntries();
  if (zipEntries.length > 20000) throw new Error(`Too many files in zip: ${zipEntries.length}`);

  // Find problem.xml entry in memory — at root or one level deep
  let xmlEntry = zipEntries.find(e => !e.isDirectory && e.entryName === 'problem.xml');
  if (!xmlEntry) {
    xmlEntry = zipEntries.find(e => !e.isDirectory && /^[^/]+\/problem\.xml$/.test(e.entryName));
  }
  if (!xmlEntry) throw new Error('problem.xml not found in zip');

  // Strip the subdirectory prefix so all paths become relative to package root
  const prefix = xmlEntry.entryName === 'problem.xml' ? '' : xmlEntry.entryName.split('/')[0] + '/';

  const xmlContent = xmlEntry.getData().toString('utf-8');
  const model = parseProblemXml(xmlContent);

  const shortName = model.shortName || `problem_${Date.now()}`;

    // Check if problem exists for this user
    let problemId: number;
    const existing = db.prepare('SELECT id FROM problems WHERE owner_id = ? AND short_name = ?').get(ownerId, shortName) as { id: number } | undefined;

    if (existing && !overwriteExisting) {
      throw new Error(`Problem '${shortName}' already exists. Use overwrite=true to replace.`);
    }

    if (existing) {
      problemId = existing.id;
      // Clean old data (keep problem row)
      const problemDir = getProblemDir(problemId);
      if (fs.existsSync(problemDir)) {
        fs.rmSync(problemDir, { recursive: true, force: true });
      }
      // Clear related tables
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

    // Update problem general info
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

    // Names
    for (const n of model.names) {
      upsertProblemName(problemId, n.language, n.value);
    }

    // Extract all zip entries directly into problemDir (single pass, no temp copy)
    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      // Strip the package-root prefix so paths are relative to problem dir
      const relName = prefix ? entry.entryName.slice(prefix.length) : entry.entryName;
      if (!relName) continue;
      const normalized = path.normalize(relName);
      if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
        warnings.push(`Skipped unsafe path: ${entry.entryName}`);
        continue;
      }
      const dest = path.join(problemDir, normalized);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
      filesImported++;
    }

    // Testsets + tests
    let testsImported = 0;
    for (const ts of model.judging.testsets) {
      const testset = getOrCreateTestset(problemId, ts.name);

      // Update testset TL/ML if different from problem defaults
      db.prepare('UPDATE testsets SET time_limit = ?, memory_limit = ?, input_path_pattern = ?, answer_path_pattern = ? WHERE id = ?')
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

      // Groups
      for (const g of ts.groups) {
        upsertTestGroup(testset.id, g.name, {
          points: g.points ?? 0,
          pointsPolicy: g.pointsPolicy,
          feedbackPolicy: g.feedbackPolicy,
          dependencies: g.dependencies,
        });
      }

      // Enable groups/points if present
      if (ts.groups.length > 0) {
        db.prepare('UPDATE testsets SET groups_enabled = 1 WHERE id = ?').run(testset.id);
      }
      const hasPoints = ts.tests.some(t => (t.points ?? 0) > 0);
      if (hasPoints) {
        db.prepare('UPDATE testsets SET points_enabled = 1 WHERE id = ?').run(testset.id);
      }
    }

    // Files (resources)
    for (const r of model.files.resources) {
      upsertFile(problemId, r.path, {
        file_role: 'resource',
        source_type: r.type ?? '',
        for_types: r.forTypes ?? '',
        stages: r.stages ?? '',
        assets_attr: r.assets ?? '',
        is_main: r.main === 'true' ? 1 : 0,
        extra_attrs: JSON.stringify(r._extraAttrs ?? {}),
      });
    }
    for (const e of model.files.executables) {
      if (e.source) {
        upsertFile(problemId, e.source.path, { file_role: 'executable_source', source_type: e.source.type });
      }
      if (e.binary) {
        upsertFile(problemId, e.binary.path, { file_role: 'executable_binary', source_type: e.binary.type });
      }
      if (e.source || e.binary) {
        db.prepare('INSERT INTO executables (problem_id, source_path, source_type, binary_path, binary_type) VALUES (?, ?, ?, ?, ?)')
          .run(problemId, e.source?.path ?? '', e.source?.type ?? '', e.binary?.path ?? '', e.binary?.type ?? '');
      }
    }

    // Assets: checker
    if (model.assets.checker) {
      const c = model.assets.checker;
      upsertAsset(problemId, 'checker', {
        name: c.name ?? '',
        checker_type: c.type ?? 'testlib',
        source_path: c.source?.path ?? '',
        source_type: c.source?.type ?? '',
        binary_path: c.binary?.path ?? '',
        binary_type: c.binary?.type ?? '',
        copy_path: c.copy?.path ?? '',
        copy_type: c.copy?.type ?? '',
      });

      // Checker tests
      if (c.testset?.tests) {
        for (let i = 0; i < c.testset.tests.length; i++) {
          upsertCheckerTest(problemId, i + 1, {
            expected_verdict: c.testset.tests[i].verdict ?? 'OK',
          });
        }
      }
    }

    // Assets: validators
    for (let vi = 0; vi < model.assets.validators.length; vi++) {
      const v = model.assets.validators[vi];
      // First validator is the main one
      if (vi === 0) {
        upsertAsset(problemId, 'validator', {
          source_path: v.source?.path ?? '',
          source_type: v.source?.type ?? '',
          binary_path: v.binary?.path ?? '',
          binary_type: v.binary?.type ?? '',
        });
      }

      // Validator tests
      if (v.testset?.tests) {
        for (let ti = 0; ti < v.testset.tests.length; ti++) {
          const vt = v.testset.tests[ti];
          // Load actual test file if exists
          const testFilePath = path.join(problemDir, v.testset.inputPathPattern.replace('%02d', String(ti + 1).padStart(2, '0')));
          let inputContent = '';
          if (fs.existsSync(testFilePath)) {
            inputContent = fs.readFileSync(testFilePath, 'utf-8');
          }
          upsertValidatorTest(problemId, vi, ti + 1, {
            input: inputContent,
            expected_verdict: vt.verdict ?? 'VALID',
            testset_name: vt.testset ?? '',
            group_name: vt.group ?? '',
          });
        }
      }
    }

    // Assets: interactor
    if (model.assets.interactor) {
      const i = model.assets.interactor;
      upsertAsset(problemId, 'interactor', {
        source_path: i.source?.path ?? '',
        source_type: i.source?.type ?? '',
        binary_path: i.binary?.path ?? '',
        binary_type: i.binary?.type ?? '',
      });
      if (i.runs) {
        db.prepare('DELETE FROM interactor_runs WHERE problem_id = ?').run(problemId);
        for (const r of i.runs) {
          db.prepare('INSERT INTO interactor_runs (problem_id, run_index) VALUES (?, ?)').run(problemId, r);
        }
      }
      // Mark interactive
      updateProblem(problemId, { interactive: 1 });
    }

    // Solutions
    for (const s of model.assets.solutions) {
      upsertSolution(problemId, s.source?.path ?? s.binary?.path ?? '', {
        source_type: s.source?.type ?? '',
        binary_path: s.binary?.path ?? '',
        binary_type: s.binary?.type ?? '',
        tag: s.tag,
      });

      // Load .desc file if exists
      if (s.source?.path) {
        const descPath = path.join(problemDir, s.source.path + '.desc');
        if (fs.existsSync(descPath)) {
          // desc file content - already in dir, no action needed
        }
      }
    }

    // Statements: parse problem-properties.json for rich content
    const langs = new Set<string>();
    for (const st of model.statements) langs.add(st.language);
    for (const tt of model.tutorials) langs.add(tt.language);

    for (const lang of langs) {
      // Try problem-properties.json first (richest source)
      const propsJsonPath = path.join(problemDir, 'statements', lang, 'problem-properties.json');
      if (fs.existsSync(propsJsonPath)) {
        try {
          const props = JSON.parse(fs.readFileSync(propsJsonPath, 'utf-8'));
          upsertStatement(problemId, lang, {
            name: props.name ?? '',
            legend: props.legend ?? '',
            input_section: props.input ?? '',
            output_section: props.output ?? '',
            scoring: props.scoring ?? '',
            interaction: props.interaction ?? '',
            notes: props.notes ?? '',
            tutorial: props.tutorial ?? '',
          });
        } catch {
          warnings.push(`Failed to parse problem-properties.json for ${lang}`);
        }
      } else {
        // Try reading statement-sections files
        const sectionsDir = path.join(problemDir, 'statement-sections', lang);
        const getData = (name: string) => {
          const p = path.join(sectionsDir, `${name}.tex`);
          return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
        };
        upsertStatement(problemId, lang, {
          name: getData('name'),
          legend: getData('legend'),
          input_section: getData('input'),
          output_section: getData('output'),
          scoring: getData('scoring'),
          interaction: getData('interaction'),
          notes: getData('notes'),
          tutorial: getData('tutorial'),
        });
      }

      // Also import problem name from statement
      const nameTex = path.join(problemDir, 'statement-sections', lang, 'name.tex');
      if (fs.existsSync(nameTex)) {
        const nameContent = fs.readFileSync(nameTex, 'utf-8').trim();
        if (nameContent) upsertProblemName(problemId, lang, nameContent);
      }
    }

    // Check problem_names - also from model.names
    for (const n of model.names) {
      upsertProblemName(problemId, n.language, n.value);
    }

    // Properties
    for (const p of model.properties) {
      setProperty(problemId, p.name, p.value);
    }

    // Tags
    setTags(problemId, model.tags);

    // Store raw problem.xml for reference
    fs.writeFileSync(path.join(problemDir, 'problem.xml'), xmlContent);

  return {
    problemId,
    shortName,
    warnings,
    errors,
    filesImported,
    testsImported,
  };
}
