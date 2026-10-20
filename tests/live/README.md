# Live MCP journeys

The live journeys run the built MCP server against a deployed Visibilio gateway. They call real tools and check real results. The tests in `tests/integration/` mock `fetch`, so they check only the requests that the MCP sends.

## Journeys

| ID | File | Checks |
|---|---|---|
| J1 | `brief-carries-active-product.test.ts` | A brief that `create_brief` makes belongs to the active product. |

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
