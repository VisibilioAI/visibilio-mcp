# Connect Visibilio to Claude

Use your Visibilio product knowledge, brand voice and content from a Claude
conversation. Inspect existing work, create and revise drafts, plan content and
request publication to connected destinations.

## Before you connect

You need a Visibilio account with access to an organization and product. Generation
requires the relevant access and available usage allowance. Publishing requires a
channel or content hub configured in Visibilio. Performance and AI visibility
features require available data and may need to be enabled for your organization.

## Connect your account

1. Open **Customize > Connectors** in Claude.
2. Find Visibilio in the directory when it is listed. Before listing, choose the
   custom connector option and enter `https://mcp.visibilio.ai/mcp`.
3. Select **Connect**, sign in to Visibilio and review the requested permissions.
4. Approve the connection and return to Claude.
5. Enable Visibilio in your conversation. Ask Claude to list your organizations
   and products, then select the workspace you want to use.

If your organization controls connector access, ask its administrator to enable
Visibilio.

## Try these requests

- “Show my Visibilio products and the content waiting for review.”
- “Find our article about editorial review and summarize its recommendations.”
- “Use the selected product's brand voice and knowledge to draft a LinkedIn post.
  Save it as a draft and do not publish it.”

## What you can do

Read products, audiences, brand voice, knowledge, briefs, content plans, signals
and content items. Create and edit supported records, generate drafts and
repurpose existing content. Review the work queue and inspect versions. Publish
or schedule content to a configured channel or hub. Explore available performance
and AI visibility data.

## Choose the right workspace

Tell Claude which organization and product to use. Ask it to confirm the selection
before changing or publishing content, particularly if you belong to more than
one organization.

## Drafting and publishing

Ask for a draft when you want work saved for review. Generation workflows can
return generated text that you then ask Claude to save. Some generation and
repurposing tools save results directly. Request publication or scheduling only
when you are ready, naming the exact item, destination and time.

Review text, links, timing and destination before you approve an action in
Claude. The connector includes write and delete operations. Deletion can
permanently remove content. Claude's confirmation prompts depend on the action
and your connector permissions; do not assume every change will receive a
separate prompt.

## Feature availability

The connector uses capabilities available in your Visibilio workspace. A missing
measurement, disconnected channel, disabled feature or exhausted usage allowance
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
workspace information to Claude. When you ask for generation or publication,
Visibilio processes the request through the services configured for that
operation. Include only information needed for your request.

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
| Publication queued                     | Check the schedule or publication status before treating the item as published. |

For unexpected results, record the tool name, time, selected product and error
message. Send a redacted report to team@visibilio.ai or open a
[GitHub issue](https://github.com/VisibilioAI/visibilio-mcp/issues). Do not put
passwords, tokens or private customer content in a public issue.
