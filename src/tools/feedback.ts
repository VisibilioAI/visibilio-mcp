import { z } from 'zod';
import { defineTool, mutating, pick, requireStringArg, type ToolDefinition } from './_define.js';

const sendFeedback = defineTool({
  name: 'send_feedback',
  title: 'Send feedback',
  description:
    'Send product feedback to the Visibilio team (a bug, a wish, a confusing tool). Optional 1-5 rating.',
  inputSchema: {
    message: z.string().min(1).max(2000),
    rating: z.number().int().min(1).max(5).optional(),
  },
  annotations: mutating,
  handler: async (args, session) => {
    requireStringArg(args, 'message');
    await session.client.post('/api/v2/feedback', {
      ...pick(args, ['message', 'rating']),
      page_url: 'mcp://visibilio',
    });
    return 'Thanks, your feedback was sent to the Visibilio team.';
  },
});

export const feedbackTools: readonly ToolDefinition[] = [sendFeedback];
