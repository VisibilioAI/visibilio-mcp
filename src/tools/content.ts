import { defineTool, type ToolDescriptor } from './_define.js';
import { runWorkflow } from './_workflow.js';

const DEFAULT_TIMEOUT_SECONDS = 120;

const writer = (name: string, contentType: string): ToolDescriptor =>
  defineTool(name, async (args, session) =>
    runWorkflow(session, {
      contentType,
      topic: String(args.topic ?? ''),
      tone: optionalString(args.tone),
      keyPoints: optionalString(args.key_points),
      audienceId: optionalString(args.audience_id),
      includeImage: args.include_image === true || args.include_image === 'true',
      timeoutSeconds: Number(args.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS),
    })
  );

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const contentTools: readonly ToolDescriptor[] = [
  writer('write_linkedin_post', 'linkedin_post'),
  writer('write_blog_article', 'blog_article'),
  writer('write_tweet', 'tweet'),
  writer('write_facebook_post', 'facebook_post'),
  writer('write_newsletter', 'newsletter'),
  writer('write_press_release', 'press_release'),
  writer('write_email_campaign', 'email_campaign'),
  writer('write_instagram_caption', 'instagram_caption'),
  writer('write_youtube_description', 'youtube_description'),
  writer('write_tiktok_script', 'tiktok_script'),
  writer('write_website_copy', 'website_copy'),
  writer('write_ad_copy', 'ad_copy'),
];
