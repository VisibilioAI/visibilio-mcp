# Live MCP journeys

The live journeys run the built MCP server against a deployed Visibilio gateway. They call real tools and check real results. The tests in `tests/integration/` mock `fetch`, so they check only the requests that the MCP sends.

## Journeys

| ID | File | Checks |
|---|---|---|
| J1 | `brief-carries-active-product.test.ts` | A brief that `create_brief` makes belongs to the active product. |
| J3 | `context-survives-restart.test.ts` | The hosted HTTP server keeps the active organization and product after a restart. |

J1 uses the stdio server (`dist/cli.js`). J3 uses the HTTP server (`dist/http.js`), because only the HTTP server stores the active context at the gateway.

## Fixture

The journeys use one test organization. The organization has one product and one `vsk_` API key with the `mcp` scope. Mark the organization as a test fixture, so that scheduled jobs do not spend money on it.

## Environment variables

Set these four variables before you run the journeys. Do not commit the values.

| Variable | Value |
|---|---|
| `VISIBILIO_LIVE_GATEWAY_URL` | The gateway URL |
| `VISIBILIO_LIVE_API_KEY` | The `vsk_` key of the fixture organization |
| `VISIBILIO_LIVE_ORGANIZATION_ID` | The fixture organization ID |
| `VISIBILIO_LIVE_PRODUCT_ID` | The fixture product ID |

## Run the journeys

1. Set the four variables.
2. Build the server and run the journeys:

   ```bash
   npm run test:live
   ```

A journey fails when a variable is missing. It does not skip, because a skipped journey looks like a passed journey.

## In CI

The `live-journeys` job in `.github/workflows/ci.yml` runs the journeys after the `test` job passes.

- The job runs on a push to `main` and on a pull request from a branch of this repository.
- The job reads the four variables from repository secrets with the same names.
- GitHub gives no secrets to a pull request from a fork. For such a pull request, the job is skipped, and the skip shows in the checks list.
- Only one `live-journeys` job runs at a time, because all runs share one fixture organization.

## Keep personal data out of the logs

The CI logs of this repository are public. A failed assertion prints the value that it received. Thus assert on the smallest value that proves the result, for example one line of a tool's text. Do not assert on the full text of `whoami`, because it contains the name and e-mail address of the account.
