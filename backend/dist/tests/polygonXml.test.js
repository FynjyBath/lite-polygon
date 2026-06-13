"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const parser_1 = require("../polygon-xml/parser");
const generator_1 = require("../polygon-xml/generator");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const FIXTURES_DIR = path_1.default.join(__dirname, '..', '..', '..', '..', 'data', 'fixtures');
const ROOT = path_1.default.join(__dirname, '..', '..', '..');
(0, vitest_1.describe)('polygon XML parser', () => {
    (0, vitest_1.it)('parses rombuses problem.xml', () => {
        const xml = fs_1.default.readFileSync(path_1.default.join('/tmp/fixture-inspect/rombuses-standard/problem.xml'), 'utf-8');
        const model = (0, parser_1.parseProblemXml)(xml);
        (0, vitest_1.expect)(model.shortName).toBe('rombuses');
        (0, vitest_1.expect)(model.revision).toBe('59');
        (0, vitest_1.expect)(model.url).toContain('polygon.codeforces.com');
        (0, vitest_1.expect)(model.names.length).toBe(1);
        (0, vitest_1.expect)(model.names[0].language).toBe('russian');
        (0, vitest_1.expect)(model.names[0].value).toBe('Железная няня');
        (0, vitest_1.expect)(model.judging.testsets.length).toBe(1);
        (0, vitest_1.expect)(model.judging.testsets[0].name).toBe('tests');
        (0, vitest_1.expect)(model.judging.testsets[0].tests.length).toBe(22);
        (0, vitest_1.expect)(model.judging.testsets[0].tests[0].method).toBe('manual');
        (0, vitest_1.expect)(model.judging.testsets[0].tests[0].sample).toBe(true);
        (0, vitest_1.expect)(model.judging.testsets[0].tests[1].method).toBe('generated');
        (0, vitest_1.expect)(model.judging.testsets[0].tests[1].cmd).toBe('gen rand 10000 100000 55 1');
        (0, vitest_1.expect)(model.assets.checker).toBeTruthy();
        (0, vitest_1.expect)(model.assets.checker.name).toBe('std::ncmp.cpp');
        (0, vitest_1.expect)(model.assets.validators.length).toBe(1);
        (0, vitest_1.expect)(model.assets.validators[0].testset.tests.length).toBe(7);
        (0, vitest_1.expect)(model.assets.solutions.length).toBe(16);
        const mainSol = model.assets.solutions.find(s => s.tag === 'main');
        (0, vitest_1.expect)(mainSol).toBeTruthy();
        (0, vitest_1.expect)(mainSol.source.path).toBe('solutions/g40_avx_smart.cpp');
        (0, vitest_1.expect)(model.tags).toContain('avx');
        (0, vitest_1.expect)(model.tags).toContain('data structures');
        (0, vitest_1.expect)(model.properties.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(model.properties[0].name).toBe('tests-wellformed');
    });
    (0, vitest_1.it)('parses zaoch problem.xml with groups', () => {
        const xml = fs_1.default.readFileSync(path_1.default.join('/tmp/fixture-inspect/zaoch-standard/problem.xml'), 'utf-8');
        const model = (0, parser_1.parseProblemXml)(xml);
        (0, vitest_1.expect)(model.shortName).toBe('zaoch-2012-2-7');
        (0, vitest_1.expect)(model.judging.testsets[0].tests.length).toBe(49);
        (0, vitest_1.expect)(model.judging.testsets[0].groups.length).toBe(5);
        const g2 = model.judging.testsets[0].groups.find(g => g.name === '2');
        (0, vitest_1.expect)(g2).toBeTruthy();
        (0, vitest_1.expect)(g2.dependencies).toContain('1');
    });
    (0, vitest_1.it)('parses joisc problem.xml with interactor', () => {
        const xml = fs_1.default.readFileSync(path_1.default.join('/tmp/fixture-inspect/joisc-standard/problem.xml'), 'utf-8');
        const model = (0, parser_1.parseProblemXml)(xml);
        (0, vitest_1.expect)(model.shortName).toBe('joisc-2018-3-1');
        (0, vitest_1.expect)(model.assets.interactor).toBeTruthy();
        (0, vitest_1.expect)(model.assets.interactor.source.path).toContain('interactor.cpp');
        (0, vitest_1.expect)(model.assets.interactor.runs).toEqual([1, 2]);
    });
    (0, vitest_1.it)('round-trips: parse -> generate -> parse gives same model', () => {
        const xml = fs_1.default.readFileSync('/tmp/fixture-inspect/rombuses-standard/problem.xml', 'utf-8');
        const model1 = (0, parser_1.parseProblemXml)(xml);
        const generated = (0, generator_1.generateProblemXml)(model1);
        const model2 = (0, parser_1.parseProblemXml)(generated);
        (0, vitest_1.expect)(model2.shortName).toBe(model1.shortName);
        (0, vitest_1.expect)(model2.revision).toBe(model1.revision);
        (0, vitest_1.expect)(model2.names.length).toBe(model1.names.length);
        (0, vitest_1.expect)(model2.judging.testsets[0].tests.length).toBe(model1.judging.testsets[0].tests.length);
        (0, vitest_1.expect)(model2.assets.solutions.length).toBe(model1.assets.solutions.length);
        (0, vitest_1.expect)(model2.tags.sort()).toEqual(model1.tags.sort());
        (0, vitest_1.expect)(model2.properties.length).toBe(model1.properties.length);
    });
    (0, vitest_1.it)('preserves test entry attributes including sample and cmd', () => {
        const xml = `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<problem revision="1" short-name="test">
  <names/>
  <statements/>
  <tutorials/>
  <judging input-file="" output-file="" run-count="1">
    <testset name="tests">
      <time-limit>1000</time-limit>
      <memory-limit>268435456</memory-limit>
      <test-count>3</test-count>
      <input-path-pattern>tests/%02d</input-path-pattern>
      <answer-path-pattern>tests/%02d.a</answer-path-pattern>
      <tests>
        <test method="manual" sample="true"/>
        <test cmd="gen 1 100 42" method="generated"/>
        <test cmd="gen 2 1000 99" method="generated" group="1" points="10.0"/>
      </tests>
    </testset>
  </judging>
  <files><resources/><executables/></files>
  <assets><solutions/></assets>
  <properties/>
  <stresses><stress-count>0</stress-count><stress-path-pattern>stresses/%03d</stress-path-pattern><list/></stresses>
  <tags/>
</problem>`;
        const model = (0, parser_1.parseProblemXml)(xml);
        (0, vitest_1.expect)(model.judging.testsets[0].tests[0].sample).toBe(true);
        (0, vitest_1.expect)(model.judging.testsets[0].tests[1].cmd).toBe('gen 1 100 42');
        (0, vitest_1.expect)(model.judging.testsets[0].tests[2].group).toBe('1');
        (0, vitest_1.expect)(model.judging.testsets[0].tests[2].points).toBe(10.0);
    });
    (0, vitest_1.it)('handles UTF-8 content correctly', () => {
        const xml = `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<problem revision="1" short-name="test">
  <names>
    <name language="russian" value="Железная няня"/>
    <name language="chinese" value="铁保姆"/>
  </names>
  <statements/><tutorials/>
  <judging input-file="" output-file="" run-count="1">
    <testset name="tests">
      <time-limit>1000</time-limit>
      <memory-limit>268435456</memory-limit>
      <test-count>0</test-count>
      <input-path-pattern>tests/%02d</input-path-pattern>
      <answer-path-pattern>tests/%02d.a</answer-path-pattern>
      <tests/>
    </testset>
  </judging>
  <files><resources/><executables/></files>
  <assets><solutions/></assets>
  <properties/><stresses><stress-count>0</stress-count><stress-path-pattern>stresses/%03d</stress-path-pattern><list/></stresses>
  <tags/>
</problem>`;
        const model = (0, parser_1.parseProblemXml)(xml);
        (0, vitest_1.expect)(model.names[0].value).toBe('Железная няня');
        (0, vitest_1.expect)(model.names[1].value).toBe('铁保姆');
        // Round-trip preserves UTF-8
        const gen = (0, generator_1.generateProblemXml)(model);
        (0, vitest_1.expect)(gen).toContain('Железная няня');
        (0, vitest_1.expect)(gen).toContain('铁保姆');
    });
});
