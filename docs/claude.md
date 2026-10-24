# Connect Visibilio to Claude

Use your Visibilio product knowledge, brand voice and content from a Claude
conversation. Visibilio generates the text using your workspace context, and
Claude displays the result. Inspect existing work, save and revise drafts, review
content and explore available measurements.

This guide describes the directory endpoint at
`https://mcp.visibilio.ai/claude/mcp`. It exposes 75 reviewed tools and 10 resources.
Generation uses Visibilio's enforced text-only workflow. AI image, video and audio
generation and publication workflows are unavailable on this endpoint.

## Before you connect

You need a Visibilio account with access to an organization and product. Generation
requires the relevant access and available usage allowance. Performance and AI visibility
features require available data and may need to be enabled for your organization.

## Connect your account

1. Open **Customize > Connectors** in Claude.
2. Find Visibilio in the directory when it is listed. Before listing, choose the
   custom connector option and enter `https://mcp.visibilio.ai/claude/mcp`.
3. Select **Connect**, sign in to Visibilio and review the requested permissions.
4. Approve the connection and return to Claude.
5. Enable Visibilio in your conversation. Ask Claude to list your organizations
   and products, then select the workspace you want to use.

If your organization controls connector access, ask its administrator to enable
Visibilio.

## Try these requests

- “Show my Visibilio products and the content waiting for review.”
- “Find our article about editorial review and summarize its recommendations.”
- “Ask Visibilio to generate a LinkedIn post using this product's brand voice,
  knowledge and audience. Show me the text Visibilio returns.”
- “Save the text from that Visibilio generation as a draft for review.”

## What you can do

Read products, audiences, brand voice, knowledge, briefs, content plans, signals
and content items. Ask Visibilio to generate written content from a request, brief
or source text. Review the returned text, save it as a draft, edit saved records,
inspect versions and explore available performance and AI visibility data.

## Choose the right workspace

Tell Claude which organization and product to use. Ask it to confirm the selection
before changing content, particularly if you belong to more than
one organization.

## Generate in Visibilio and review in Claude

Claude sends your request to Visibilio using `start_workflow`. Visibilio creates
the content with its own writing service. `get_workflow_status` returns the
generated text when it is ready. You can then ask Claude to save the result with
`create_content_item`, including its `source_execution_id`, and review it in
Visibilio.

The text-only service rejects workflow plans that require media or an unreviewed
agent, and forces image generation off on writer steps. If that happens, request
written content without images, video or audio. Generation still uses your
Visibilio usage allowance.

The connector includes write and delete operations. Deletion can
permanently remove content. Claude's confirmation prompts depend on the action
and your connector permissions; do not assume every change will receive a
separate prompt. Publication and scheduling can be performed in Visibilio after
review; this directory connector does not expose those actions.

## Feature availability

The connector uses capabilities available in your Visibilio workspace. A missing
measurement, disabled feature or exhausted usage allowance
can limit a request. An empty measurement result does not mean that the connector
is disconnected.

## Disconnect and revoke access

To remove the connector from Claude, open **Customize > Connectors** and disconnect
or remove Visibilio. To revoke its authorization in Visibilio, open **Settings >
API Keys > Connected Apps** and revoke the connection. Revoking authorization does
not delete content already saved or published; manage that content in Visibilio
or its destination.

## Data and privacy

Tool calls send their arguments to Visibilio. Results return the requested
workspace information to Claude. When you ask for generation, Visibilio processes
the request through the services configured for that operation. Include only
information needed for your request.

Read the [Visibilio Privacy Policy](https://visibilio.ai/privacy-policy/) and
[terms](https://visibilio.ai/terms-service/). Contact team@visibilio.ai with
questions about data or access.

## Troubleshooting

| Symptom                                | What to do                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| Connection rejected or expired         | Reconnect and check that your Visibilio account is active.                      |
| No active product                      | Ask Claude to list products and select one.                                     |
| Access denied                          | Confirm your organization membership and the requested permissions.             |
| Feature not enabled or no measurements | Ask your Visibilio administrator or support to check availability and data.     |
| Generation still running               | Ask Claude to check the workflow status before starting another generation.     |

For unexpected results, record the tool name, time, selected product and error
message. Send a redacted report to team@visibilio.ai or open a
[GitHub issue](https://github.com/VisibilioAI/visibilio-mcp/issues). Do not put
passwords, tokens or private customer content in a public issue.
