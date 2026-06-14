import { describe, it, expect } from 'vitest';
import { parseProblemXml } from '../polygon-xml/parser';
import { generateProblemXml } from '../polygon-xml/generator';
import fs from 'fs';
import path from 'path';

const FIXTURES_DIR = path.join(__dirname, '..', '..', '..', '..', 'data', 'fixtures');
const ROOT = path.join(__dirname, '..', '..', '..');

const ROMBUSES_XML = '/tmp/fixture-inspect/rombuses-standard/problem.xml';
const ZAOCH_XML = '/tmp/fixture-inspect/zaoch-standard/problem.xml';
const JOISC_XML = '/tmp/fixture-inspect/joisc-standard/problem.xml';

describe('polygon XML parser', () => {
  it('parses rombuses problem.xml', () => {
    if (!fs.existsSync(ROMBUSES_XML)) { console.warn('Fixture not found, skipping'); return; }
    const xml = fs.readFileSync(ROMBUSES_XML, 'utf-8');
    const model = parseProblemXml(xml);

    expect(model.shortName).toBe('rombuses');
    expect(model.revision).toBe('59');
    expect(model.url).toContain('polygon.codeforces.com');
    expect(model.names.length).toBe(1);
    expect(model.names[0].language).toBe('russian');
    expect(model.names[0].value).toBe('Железная няня');
    expect(model.judging.testsets.length).toBe(1);
    expect(model.judging.testsets[0].name).toBe('tests');
    expect(model.judging.testsets[0].tests.length).toBe(22);
    expect(model.judging.testsets[0].tests[0].method).toBe('manual');
    expect(model.judging.testsets[0].tests[0].sample).toBe(true);
    expect(model.judging.testsets[0].tests[1].method).toBe('generated');
    expect(model.judging.testsets[0].tests[1].cmd).toBe('gen rand 10000 100000 55 1');
    expect(model.assets.checker).toBeTruthy();
    expect(model.assets.checker!.name).toBe('std::ncmp.cpp');
    expect(model.assets.validators.length).toBe(1);
    expect(model.assets.validators[0].testset!.tests.length).toBe(7);
    expect(model.assets.solutions.length).toBe(16);
    const mainSol = model.assets.solutions.find(s => s.tag === 'main');
    expect(mainSol).toBeTruthy();
    expect(mainSol!.source!.path).toBe('solutions/g40_avx_smart.cpp');
    expect(model.tags).toContain('avx');
    expect(model.tags).toContain('data structures');
    expect(model.properties.length).toBeGreaterThan(0);
    expect(model.properties[0].name).toBe('tests-wellformed');
  });

  it('parses zaoch problem.xml with groups', () => {
    if (!fs.existsSync(ZAOCH_XML)) { console.warn('Fixture not found, skipping'); return; }
    const xml = fs.readFileSync(ZAOCH_XML, 'utf-8');
    const model = parseProblemXml(xml);

    expect(model.shortName).toBe('zaoch-2012-2-7');
    expect(model.judging.testsets[0].tests.length).toBe(49);
    expect(model.judging.testsets[0].groups.length).toBe(5);
    const g2 = model.judging.testsets[0].groups.find(g => g.name === '2');
    expect(g2).toBeTruthy();
    expect(g2!.dependencies).toContain('1');
  });

  it('parses joisc problem.xml with interactor', () => {
    if (!fs.existsSync(JOISC_XML)) { console.warn('Fixture not found, skipping'); return; }
    const xml = fs.readFileSync(JOISC_XML, 'utf-8');
    const model = parseProblemXml(xml);

    expect(model.shortName).toBe('joisc-2018-3-1');
    expect(model.assets.interactor).toBeTruthy();
    expect(model.assets.interactor!.source!.path).toContain('interactor.cpp');
    expect(model.assets.interactor!.runs).toEqual([1, 2]);
  });

  it('round-trips: parse -> generate -> parse gives same model', () => {
    if (!fs.existsSync(ROMBUSES_XML)) { console.warn('Fixture not found, skipping'); return; }
    const xml = fs.readFileSync(ROMBUSES_XML, 'utf-8');
    const model1 = parseProblemXml(xml);
    const generated = generateProblemXml(model1);
    const model2 = parseProblemXml(generated);

    expect(model2.shortName).toBe(model1.shortName);
    expect(model2.revision).toBe(model1.revision);
    expect(model2.names.length).toBe(model1.names.length);
    expect(model2.judging.testsets[0].tests.length).toBe(model1.judging.testsets[0].tests.length);
    expect(model2.assets.solutions.length).toBe(model1.assets.solutions.length);
    expect(model2.tags.sort()).toEqual(model1.tags.sort());
    expect(model2.properties.length).toBe(model1.properties.length);
  });

  it('preserves test entry attributes including sample and cmd', () => {
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
    const model = parseProblemXml(xml);
    expect(model.judging.testsets[0].tests[0].sample).toBe(true);
    expect(model.judging.testsets[0].tests[1].cmd).toBe('gen 1 100 42');
    expect(model.judging.testsets[0].tests[2].group).toBe('1');
    expect(model.judging.testsets[0].tests[2].points).toBe(10.0);
  });

  it('handles UTF-8 content correctly', () => {
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
    const model = parseProblemXml(xml);
    expect(model.names[0].value).toBe('Железная няня');
    expect(model.names[1].value).toBe('铁保姆');
    // Round-trip preserves UTF-8
    const gen = generateProblemXml(model);
    expect(gen).toContain('Железная няня');
    expect(gen).toContain('铁保姆');
  });
});
