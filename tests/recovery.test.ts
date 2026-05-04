import { describe, it, expect } from 'vitest';
import spec from '../spec/mcp-tools.json' with { type: 'json' };
import { allTools } from '../src/tools/index.js';
import { allResources } from '../src/resources/index.js';

describe('Recovery — tools registered match bytecode-extracted spec', () => {
  it(`registers exactly ${spec.totalToolsExtracted} tools`, () => {
    expect(allTools.length).toBe(spec.totalToolsExtracted);
  });

  it('registers all tool names from spec', () => {
    const expected = spec.tools.map((t) => t.name).sort();
    const actual = allTools.map((t) => t.name).sort();
    expect(actual).toEqual(expected);
  });

  it.each(spec.tools)('tool $name has a non-empty description', (toolSpec) => {
    const tool = allTools.find((t) => t.name === toolSpec.name);
    expect(tool, `tool ${toolSpec.name} missing from registry`).toBeDefined();
    expect(tool!.description.length).toBeGreaterThan(0);
  });

  it.each(spec.tools)('tool $name accepts all spec arguments', (toolSpec) => {
    const tool = allTools.find((t) => t.name === toolSpec.name);
    expect(tool).toBeDefined();
    const schemaProps = Object.keys(tool!.inputSchema.properties ?? {});
    for (const arg of toolSpec.args) {
      expect(schemaProps, `${toolSpec.name} missing arg ${arg}`).toContain(arg);
    }
  });
});

describe('Recovery — resources registered match bytecode-extracted spec', () => {
  it(`registers exactly ${spec.totalResourcesExtracted} resources`, () => {
    expect(allResources.length).toBe(spec.totalResourcesExtracted);
  });

  it('registers all resource names from spec', () => {
    const expected = spec.resources.map((r) => r.name).sort();
    const actual = allResources.map((r) => r.name).sort();
    expect(actual).toEqual(expected);
  });
});
