import { describe, it, expect } from 'vitest';
import { allTools } from '../../src/tools/index.js';
import { allResources } from '../../src/resources/index.js';

const EXPECTED_TOOLS = [
  'whoami',
  'list_organizations',
  'set_active_organization',
  'list_products',
  'set_active_product',
  'get_product',
  'create_product',
  'update_product',
  'list_content_items',
  'get_content_item',
  'create_content_item',
  'update_content_item',
  'delete_content_item',
  'duplicate_content_item',
  'list_content_item_versions',
  'restore_content_item_version',
  'generate_seo_meta',
  'validate_brand_voice',
  'repurpose_content_item',
  'quick_repurpose_content_item',
  'translate_content_item',
  'generate_cover_image',
  'list_briefs',
  'get_brief',
  'create_brief',
  'update_brief',
  'delete_brief',
  'generate_from_brief',
  'list_brief_content_items',
  'start_workflow',
  'confirm_workflow',
  'get_workflow_status',
  'cancel_workflow',
  'list_content_plans',
  'get_content_plan',
  'create_content_plan',
  'generate_content_plan',
  'get_content_plan_status',
  'list_planned_topics',
  'get_planned_topic_brief',
  'list_audiences',
  'create_audience',
  'delete_audience',
  'get_knowledge',
  'update_knowledge',
  'search_knowledge',
  'list_knowledge_proposals',
  'accept_knowledge_proposal',
  'dismiss_knowledge_proposal',
  'get_brand_voice',
  'update_brand_voice',
  'analyze_brand_voice_text',
  'get_brand_voice_analysis',
  'list_channels',
  'list_product_channels',
  'publish_social_post',
  'list_content_hubs',
  'publish_to_hub',
  'list_hub_publications',
  'list_schedules',
  'schedule_content_item',
  'cancel_schedule',
  'get_published_feed',
  'list_signals',
  'get_signal',
  'generate_from_signal',
  'add_signal_to_plan',
  'dismiss_signal',
  'get_signal_stats',
  'list_sources',
  'create_source',
  'scan_source',
  'get_daily_briefing',
  'get_operation_overview',
  'get_review_queue',
  'approve_content_item',
  'request_content_changes',
  'get_activity_feed',
  'get_product_stats',
  'list_notifications',
  'get_notification_count',
  'mark_notifications_read',
  'get_measurement_overview',
  'list_measurement_recommendations',
  'get_ai_visibility_metrics',
  'list_ai_visibility_recommendations',
  'list_ai_visibility_content_ideas',
  'list_ai_visibility_answers',
  'send_feedback',
];

const PRODUCT_SCOPED = [
  'list_content_items',
  'create_content_item',
  'list_content_plans',
  'get_content_plan',
  'create_content_plan',
  'generate_content_plan',
  'get_content_plan_status',
  'list_planned_topics',
  'get_planned_topic_brief',
  'list_audiences',
  'get_knowledge',
  'update_knowledge',
  'list_knowledge_proposals',
  'get_brand_voice',
  'update_brand_voice',
  'analyze_brand_voice_text',
  'get_brand_voice_analysis',
  'list_product_channels',
  'list_content_hubs',
  'list_schedules',
  'get_published_feed',
  'list_signals',
  'get_signal_stats',
  'scan_source',
  'get_daily_briefing',
  'get_operation_overview',
  'get_review_queue',
  'list_notifications',
  'get_measurement_overview',
  'list_measurement_recommendations',
  'get_ai_visibility_metrics',
  'list_ai_visibility_recommendations',
  'list_ai_visibility_content_ideas',
  'list_ai_visibility_answers',
  'start_workflow',
];

describe('tool catalogue — one tool per gateway capability', () => {
  it('registers exactly the expected tools, each once', () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('every tool carries a title, a description and explicit annotations', () => {
    for (const tool of allTools) {
      expect(tool.title.length, tool.name).toBeGreaterThan(0);
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
      expect(typeof tool.annotations.readOnlyHint, tool.name).toBe('boolean');
    }
  });

  it('read tools are read-only; delete/cancel tools are destructive; the rest mutate without being destructive', () => {
    for (const tool of allTools) {
      const isRead = /^(list_|get_|whoami$|search_|validate_)/.test(tool.name);
      const isDestructive = /^(delete_|cancel_)/.test(tool.name);
      if (isRead) expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
      if (isDestructive) expect(tool.annotations.destructiveHint, tool.name).toBe(true);
      if (!isRead && !isDestructive) {
        expect(tool.annotations.readOnlyHint, tool.name).toBe(false);
        expect(tool.annotations.destructiveHint, tool.name).toBe(false);
      }
    }
  });

  it('product-scoped tools accept an optional product_id override', () => {
    for (const name of PRODUCT_SCOPED) {
      const tool = allTools.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.inputSchema.product_id, `${name} should accept product_id`).toBeDefined();
      expect(tool!.inputSchema.product_id!.isOptional(), `${name}.product_id optional`).toBe(true);
    }
  });
});

describe('resource catalogue', () => {
  it('exposes the organization, the active product and every knowledge domain', () => {
    const uris = allResources.map((r) => r.uri).sort();
    expect(uris).toEqual(
      [
        'visibilio://organization',
        'visibilio://product',
        ...[
          'company_profile',
          'market_intelligence',
          'audience_data',
          'content_strategy',
          'historical_outputs',
          'scoring_profile',
          'hub_config',
          'person_profile',
        ].map((d) => `visibilio://knowledge/${d}`),
      ].sort()
    );
  });
});
