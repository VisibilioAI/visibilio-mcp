import { defineTool, stubTool, type ToolDescriptor } from './_define.js';
import { formatHttpError } from './_format.js';

interface PersonaShape {
  id?: string | number;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

const listAudiences = defineTool('list_audiences', async (_args, session) => {
  try {
    const path = `/api/v2/knowledge/${session.organizationId}/audience_data`;
    const body = (await session.client.backendGet(path, session.buildTenantHeaders())) as {
      content?: { personas?: PersonaShape[] } | PersonaShape[];
    } | null;
    const personas = extractPersonas(body?.content);
    if (personas.length === 0) {
      return 'No audience personas found. Run onboarding or generate_personas to create some.';
    }
    const lines = personas.map((p) => {
      const id = p.id ?? '?';
      const name = p.name ?? 'Unnamed';
      const desc = p.description ? ` — ${truncate(p.description, 80)}` : '';
      return `- ${name} (ID: ${id})${desc}`;
    });
    return `Audience Personas:\n${lines.join('\n')}`;
  } catch (err) {
    return formatHttpError('Error listing audiences', err);
  }
});

function extractPersonas(content: unknown): PersonaShape[] {
  if (!content) return [];
  if (Array.isArray(content)) return content as PersonaShape[];
  if (typeof content === 'object' && content !== null) {
    const obj = content as { personas?: PersonaShape[] };
    if (Array.isArray(obj.personas)) return obj.personas;
  }
  return [];
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export const audienceTools: readonly ToolDescriptor[] = [listAudiences, stubTool('get_audience')];
