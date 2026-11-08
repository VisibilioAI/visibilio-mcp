import { describe, it, expect } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { allTools } from '../../src/tools/index.js';

function tool(name: string) {
  const found = allTools.find((t) => t.name === name);
  expect(found, `${name} is registered`).toBeDefined();
  return found!;
}

function paramDescription(name: string, param: string): string | undefined {
  const schema = tool(name).inputSchema as Record<string, ZodTypeAny>;
  const field = schema[param];
  expect(field, `${name}.${param} exists`).toBeDefined();
  return field?.description;
}

describe('tool descriptions describe what the server actually does', () => {
  it('start_workflow states that auto_confirm is currently ignored', () => {
    const d = paramDescription('start_workflow', 'auto_confirm') ?? '';
    expect(d).toContain('Currently ignored');
    expect(d).not.toContain('stops at awaiting_confirmation');
  });

  it('confirm_workflow states that workflows do not pause for confirmation yet', () => {
    expect(tool('confirm_workflow').description).toContain('do not pause for confirmation yet');
  });

  it('approve_content_item approves from any status and describes the schedule placement', () => {
    const d = tool('approve_content_item').description;
    expect(d).toContain('any status');
    expect(d).toContain('next free slot');
    expect(d).not.toContain('that is in review');
  });

  it('get_review_queue does not promise a quality risk score', () => {
    const d = tool('get_review_queue').description;
    expect(d).not.toContain('risk score');
    expect(d).not.toContain('quality risk');
  });

  it('update_content_item states a status change may not create a version', () => {
    const d = tool('update_content_item').description;
    expect(d).toContain('a status change may not');
    expect(d).not.toContain('every change is versioned');
  });

  it('update_content_item marks author_name as articles only', () => {
    expect(paramDescription('update_content_item', 'author_name')).toBe('Articles only');
  });

  it('translate_content_item returns a job id and points at get_generation_job_status (meta #1070)', () => {
    const d = tool('translate_content_item').description;
    expect(d).toContain('Returns a job id');
    expect(d).toContain('get_generation_job_status');
    expect(d).not.toContain('can outlast the client timeout');
  });

  it('update_knowledge states protected keys are kept and company_profile is org-wide', () => {
    const d = tool('update_knowledge').description;
    expect(d).toContain('Protected keys are kept');
    expect(d).toContain('organization-wide');
    expect(d).not.toContain('full replace');
  });

  it('update_knowledge marks change_note as not stored yet', () => {
    expect(paramDescription('update_knowledge', 'change_note')).toBe('Not stored yet');
  });

  it('add_signal_to_plan states nothing is added when there is no free slot', () => {
    expect(tool('add_signal_to_plan').description).toContain('no free slot');
  });

  it('list_planned_topics states it returns only topics of finalised plans', () => {
    expect(tool('list_planned_topics').description).toContain('finalised plans');
  });

  it('publish_to_hub states there is no approval check and returns status and live URL', () => {
    const d = tool('publish_to_hub').description;
    expect(d).toContain('does not check that the item is approved');
    expect(d).toContain('status and the live URL');
  });

  it('publish_to_hub cross_post_channels says it schedules an announcement post', () => {
    expect(paramDescription('publish_to_hub', 'cross_post_channels')).toContain('schedule');
  });
});
