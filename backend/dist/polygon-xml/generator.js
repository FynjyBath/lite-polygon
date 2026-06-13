"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateProblemXml = generateProblemXml;
function esc(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function attrs(obj) {
    return Object.entries(obj)
        .filter(([, v]) => v != null && v !== '' && v !== undefined)
        .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
        .join('');
}
function extraAttrs(extra) {
    if (!extra)
        return '';
    return Object.entries(extra).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
}
function generateProblemXml(model) {
    const lines = [];
    lines.push('<?xml version="1.0" encoding="utf-8" standalone="no"?>');
    const probAttrs = {
        revision: model.revision,
        'short-name': model.shortName,
        url: model.url,
    };
    const probExtraStr = model._extraAttrs ? extraAttrs(model._extraAttrs) : '';
    lines.push(`<problem${attrs(probAttrs)}${probExtraStr}>`);
    // names
    if (model.names.length > 0) {
        lines.push('    <names>');
        for (const n of model.names) {
            lines.push(`        <name${attrs({ language: n.language, value: n.value })}/>`);
        }
        lines.push('    </names>');
    }
    // statements
    if (model.statements.length > 0) {
        const stEl = model['_statementsEl'];
        const stExtra = stEl ? Object.entries(stEl).map(([k, v]) => ` ${k}="${esc(v)}"`).join('') : '';
        lines.push(`    <statements${stExtra}>`);
        for (const s of model.statements) {
            const a = {
                charset: s.charset,
                language: s.language,
                mathjax: s.mathjax,
                path: s.path,
                type: s.type,
            };
            lines.push(`        <statement${attrs(a)}/>`);
        }
        lines.push('    </statements>');
    }
    // tutorials
    if (model.tutorials.length > 0) {
        const tutEl = model['_tutorialsEl'];
        const tutExtra = tutEl ? Object.entries(tutEl).map(([k, v]) => ` ${k}="${esc(v)}"`).join('') : '';
        lines.push(`    <tutorials${tutExtra}>`);
        for (const t of model.tutorials) {
            const a = {
                charset: t.charset,
                language: t.language,
                mathjax: t.mathjax,
                path: t.path,
                type: t.type,
            };
            lines.push(`        <tutorial${attrs(a)}/>`);
        }
        lines.push('    </tutorials>');
    }
    // judging
    lines.push(generateJudging(model.judging));
    // files
    lines.push(generateFiles(model.files));
    // assets
    lines.push(generateAssets(model.assets));
    // properties
    if (model.properties.length > 0) {
        lines.push('    <properties>');
        for (const p of model.properties) {
            lines.push(`        <property${attrs({ name: p.name, value: p.value })}/>`);
        }
        lines.push('    </properties>');
    }
    // stresses
    lines.push(generateStresses(model.stresses));
    // tags
    if (model.tags.length > 0) {
        lines.push('    <tags>');
        for (const t of model.tags) {
            lines.push(`        <tag${attrs({ value: t })}/>`);
        }
        lines.push('    </tags>');
    }
    // unknown nodes
    if (model._unknownNodes) {
        for (const node of model._unknownNodes) {
            lines.push(`    <!-- unknown: ${node.tagName} -->`);
        }
    }
    lines.push('</problem>');
    return lines.join('\n');
}
function generateJudging(j) {
    const lines = [];
    const ja = {
        'cpu-name': j.cpuName,
        'cpu-speed': j.cpuSpeed,
        'input-file': j.inputFile,
        'output-file': j.outputFile,
        'run-count': String(j.runCount),
    };
    const jExtra = j._extraAttrs ? extraAttrs(j._extraAttrs) : '';
    lines.push(`    <judging${attrs(ja)}${jExtra}>`);
    for (const ts of j.testsets) {
        lines.push(generateTestset(ts));
    }
    lines.push('    </judging>');
    return lines.join('\n');
}
function generateTestset(ts) {
    const lines = [];
    lines.push(`        <testset${attrs({ name: ts.name })}>`);
    lines.push(`            <time-limit>${ts.timeLimit}</time-limit>`);
    lines.push(`            <memory-limit>${ts.memoryLimit}</memory-limit>`);
    lines.push(`            <test-count>${ts.testCount}</test-count>`);
    lines.push(`            <input-path-pattern>${esc(ts.inputPathPattern)}</input-path-pattern>`);
    lines.push(`            <answer-path-pattern>${esc(ts.answerPathPattern)}</answer-path-pattern>`);
    lines.push('            <tests>');
    for (const t of ts.tests) {
        lines.push(generateTest(t));
    }
    lines.push('            </tests>');
    if (ts.groups.length > 0) {
        lines.push('            <groups>');
        for (const g of ts.groups) {
            lines.push(generateGroup(g));
        }
        lines.push('            </groups>');
    }
    lines.push('        </testset>');
    return lines.join('\n');
}
function generateTest(t) {
    const a = {};
    if (t.cmd)
        a['cmd'] = t.cmd;
    if (t.description)
        a['description'] = t.description;
    if (t.group !== undefined)
        a['group'] = t.group;
    a['method'] = t.method;
    if (t.points !== undefined)
        a['points'] = String(t.points);
    if (t.sample)
        a['sample'] = 'true';
    if (t._extraAttrs)
        Object.assign(a, t._extraAttrs);
    return `                <test${attrs(a)}/>`;
}
function generateGroup(g) {
    const lines = [];
    const a = {
        'feedback-policy': g.feedbackPolicy,
        'name': g.name,
        'points': g.points !== undefined ? String(g.points) : undefined,
        'points-policy': g.pointsPolicy,
    };
    if (g._extraAttrs)
        Object.assign(a, g._extraAttrs);
    if (g.dependencies.length === 0) {
        lines.push(`                <group${attrs(a)}/>`);
    }
    else {
        lines.push(`                <group${attrs(a)}>`);
        lines.push('                    <dependencies>');
        for (const dep of g.dependencies) {
            lines.push(`                        <dependency${attrs({ group: dep })}/>`);
        }
        lines.push('                    </dependencies>');
        lines.push('                </group>');
    }
    return lines.join('\n');
}
function generateFiles(f) {
    const lines = [];
    lines.push('    <files>');
    if (f.resources.length > 0) {
        lines.push('        <resources>');
        for (const r of f.resources) {
            const a = {
                path: r.path,
                type: r.type,
                'for-types': r.forTypes,
                stages: r.stages,
                assets: r.assets,
                main: r.main,
            };
            if (r._extraAttrs)
                Object.assign(a, r._extraAttrs);
            lines.push(`            <file${attrs(a)}/>`);
        }
        lines.push('        </resources>');
    }
    if (f.executables.length > 0) {
        lines.push('        <executables>');
        for (const e of f.executables) {
            lines.push('            <executable>');
            if (e.source)
                lines.push(`                <source${attrs({ path: e.source.path, type: e.source.type })}/>`);
            if (e.binary)
                lines.push(`                <binary${attrs({ path: e.binary.path, type: e.binary.type })}/>`);
            lines.push('            </executable>');
        }
        lines.push('        </executables>');
    }
    lines.push('    </files>');
    return lines.join('\n');
}
function generateAssets(a) {
    const lines = [];
    lines.push('    <assets>');
    if (a.checker)
        lines.push(generateChecker(a.checker));
    if (a.validators.length > 0) {
        lines.push('        <validators>');
        for (const v of a.validators)
            lines.push(generateValidator(v));
        lines.push('        </validators>');
    }
    if (a.interactor)
        lines.push(generateInteractor(a.interactor));
    if (a.solutions.length > 0) {
        lines.push('        <solutions>');
        for (const s of a.solutions)
            lines.push(generateSolution(s));
        lines.push('        </solutions>');
    }
    lines.push('    </assets>');
    return lines.join('\n');
}
function generateChecker(c) {
    const lines = [];
    const a = { name: c.name, type: c.type };
    lines.push(`        <checker${attrs(a)}>`);
    if (c.source)
        lines.push(`            <source${attrs({ path: c.source.path, type: c.source.type })}/>`);
    if (c.binary)
        lines.push(`            <binary${attrs({ path: c.binary.path, type: c.binary.type })}/>`);
    if (c.copy) {
        const ca = { path: c.copy.path, type: c.copy.type };
        lines.push(`            <copy${attrs(ca)}/>`);
    }
    if (c.testset) {
        const ts = c.testset;
        lines.push('            <testset>');
        lines.push(`                <test-count>${ts.testCount}</test-count>`);
        lines.push(`                <input-path-pattern>${esc(ts.inputPathPattern)}</input-path-pattern>`);
        lines.push(`                <output-path-pattern>${esc(ts.outputPathPattern)}</output-path-pattern>`);
        lines.push(`                <answer-path-pattern>${esc(ts.answerPathPattern)}</answer-path-pattern>`);
        lines.push('                <tests>');
        for (const t of ts.tests) {
            if (t.verdict) {
                lines.push(`                    <test${attrs({ verdict: t.verdict })}/>`);
            }
            else {
                lines.push('                    <test/>');
            }
        }
        lines.push('                </tests>');
        lines.push('            </testset>');
    }
    lines.push('        </checker>');
    return lines.join('\n');
}
function generateValidator(v) {
    const lines = [];
    lines.push('            <validator>');
    if (v.source)
        lines.push(`                <source${attrs({ path: v.source.path, type: v.source.type })}/>`);
    if (v.binary)
        lines.push(`                <binary${attrs({ path: v.binary.path, type: v.binary.type })}/>`);
    if (v.testset) {
        const ts = v.testset;
        lines.push('                <testset>');
        lines.push(`                    <test-count>${ts.testCount}</test-count>`);
        lines.push(`                    <input-path-pattern>${esc(ts.inputPathPattern)}</input-path-pattern>`);
        lines.push('                    <tests>');
        for (const t of ts.tests) {
            const ta = {
                group: t.group,
                testset: t.testset,
                verdict: t.verdict,
            };
            lines.push(`                        <test${attrs(ta)}/>`);
        }
        lines.push('                    </tests>');
        lines.push('                </testset>');
    }
    lines.push('            </validator>');
    return lines.join('\n');
}
function generateInteractor(i) {
    const lines = [];
    lines.push('        <interactor>');
    if (i.source)
        lines.push(`            <source${attrs({ path: i.source.path, type: i.source.type })}/>`);
    if (i.binary)
        lines.push(`            <binary${attrs({ path: i.binary.path, type: i.binary.type })}/>`);
    if (i.runs && i.runs.length > 0) {
        lines.push('            <runs>');
        for (const r of i.runs)
            lines.push(`                <run>${r}</run>`);
        lines.push('            </runs>');
    }
    lines.push('        </interactor>');
    return lines.join('\n');
}
function generateSolution(s) {
    const lines = [];
    lines.push(`            <solution${attrs({ tag: s.tag })}>`);
    if (s.source)
        lines.push(`                <source${attrs({ path: s.source.path, type: s.source.type })}/>`);
    if (s.binary)
        lines.push(`                <binary${attrs({ path: s.binary.path, type: s.binary.type })}/>`);
    lines.push('            </solution>');
    return lines.join('\n');
}
function generateStresses(s) {
    const lines = [];
    lines.push('    <stresses>');
    lines.push(`        <stress-count>${s.stressCount}</stress-count>`);
    lines.push(`        <stress-path-pattern>${esc(s.stressPathPattern)}</stress-path-pattern>`);
    lines.push('        <list>');
    // TODO: serialize stress entries
    lines.push('        </list>');
    lines.push('    </stresses>');
    return lines.join('\n');
}
