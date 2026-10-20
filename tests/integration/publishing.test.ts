import { describe, it, expect } from 'vitest';
import { buildSession, callTool, findTool, jsonBodyOf, pathMatcher, textOf } from './_helpers.js';

describe('publishing — channels and social', () => {
  it('list_channels lists every org channel with platform and active state', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/channels'),
        body: {
          data: [
            { id: 22, platform: 'linkedin', name: 'Company page', is_active: true },
            { id: 23, platform: 'wordpress', name: 'Blog', is_active: false },
          ],
        },
      },
    ]);

    const text = await (await findTool('list_channels')).handler({}, session);

    expect(text).toContain('Company page');
    expect(text).toContain('channel_id: 22');
    expect(text).toContain('linkedin');
    expect(text).toMatch(/inactive/);
  });

  it('list_product_channels reads the product route and shows each channel role', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/products/147/channels'),
        body: {
          data: [
            {
              id: 22,
              platform: 'linkedin',
              name: 'Company page',
              is_active: true,
              role: 'primary',
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_product_channels')).handler({}, session);

    expect(calls[0]!.url).toContain('/api/v2/products/147/channels');
    expect(text).toContain('primary');
  });

  it('publish_social_post posts the channel and reports the publishing state', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-items/501/publish-social'),
        status: 202,
        body: { data: { schedule_id: 90, zernio_post_id: 'z1', status: 'publishing' } },
      },
    ]);

    const text = await (
      await findTool('publish_social_post')
    ).handler({ content_item_id: 501, channel_id: 22 }, session);

    expect(jsonBodyOf(calls[0])).toEqual({ channel_id: 22 });
    expect(text).toContain('publishing');
    expect(text).toContain('schedule_id: 90');
  });

  it('publish_social_post surfaces a reconnection conflict as a failed result with the gateway message', async () => {
    const { session } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-items/501/publish-social'),
        status: 409,
        body: {
          error: 'CHANNEL_NEEDS_RECONNECTION',
          message: 'Reconnect LinkedIn in Settings',
          details: { platform: 'linkedin', channel_id: 22 },
        },
      },
    ]);

    const result = await callTool(
      'publish_social_post',
      { content_item_id: 501, channel_id: 22 },
      session
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Publish social post failed (HTTP 409): Reconnect LinkedIn in Settings'
    );
  });
});

describe('publishing — hubs and schedules', () => {
  it('list_content_hubs scopes to the active product and lists hubs', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/content-hubs'),
        body: {
          data: [
            {
              id: 3,
              name: 'Main site',
              site_url: 'https://acme.test',
              is_active: true,
              product_id: 147,
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (await findTool('list_content_hubs')).handler({}, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({ product_id: '147' });
    expect(text).toContain('Main site');
    expect(text).toContain('hub_id: 3');
  });

  it('publish_to_hub posts slug and category and reports the live url', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/content-hubs/3/publish/501'),
        status: 201,
        body: {
          data: {
            id: 44,
            status: 'deployed',
            live_url: 'https://acme.test/why-mcp',
            file_path: 'content/why-mcp.md',
          },
        },
      },
    ]);

    const text = await (
      await findTool('publish_to_hub')
    ).handler(
      { hub_id: 3, content_item_id: 501, slug: 'why-mcp', primary_category: 'Product' },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({ slug: 'why-mcp', primary_category: 'Product' });
    expect(text).toContain('https://acme.test/why-mcp');
    expect(text).toContain('deployed');
  });

  it('schedule_content_item posts item, channel and publish time', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('POST', '/api/v2/schedules'),
        status: 201,
        body: {
          data: {
            id: 91,
            content_item_id: 501,
            channel_id: 22,
            publish_at: '2026-10-20T09:00:00Z',
            status: 'scheduled',
          },
          cadence_warning: 'Two posts within an hour',
        },
      },
    ]);

    const text = await (
      await findTool('schedule_content_item')
    ).handler(
      { content_item_id: 501, channel_id: 22, publish_at: '2026-10-20T09:00:00Z' },
      session
    );

    expect(jsonBodyOf(calls[0])).toEqual({
      content_item_id: 501,
      channel_id: 22,
      publish_at: '2026-10-20T09:00:00Z',
    });
    expect(text).toContain('schedule_id: 91');
    expect(text).toContain('Two posts within an hour');
  });

  it('list_schedules forwards filters and the active product', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/schedules'),
        body: {
          data: [
            {
              id: 91,
              content_item_id: 501,
              channel_id: 22,
              publish_at: '2026-10-20T09:00:00Z',
              status: 'scheduled',
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('list_schedules')
    ).handler({ status: 'scheduled', from: '2026-10-01' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      product_id: '147',
      status: 'scheduled',
      from: '2026-10-01',
    });
    expect(text).toContain('schedule_id: 91');
  });

  it('cancel_schedule deletes the schedule', async () => {
    const { session, calls } = buildSession([
      { match: pathMatcher('DELETE', '/api/v2/schedules/91'), status: 204, body: undefined },
    ]);

    const text = await (await findTool('cancel_schedule')).handler({ schedule_id: 91 }, session);

    expect(calls[0]!.init?.method).toBe('DELETE');
    expect(text).toMatch(/cancelled/i);
  });

  it('get_published_feed reads the organization feed for the active product', async () => {
    const { session, calls } = buildSession([
      {
        match: pathMatcher('GET', '/api/v2/organizations/7/published-feed'),
        body: {
          data: [
            {
              id: 'hub-44',
              source: 'hub',
              content_item_id: 501,
              live_url: 'https://acme.test/why-mcp',
              channel: 'Main site',
              published_at: '2026-10-13T12:00:00Z',
              verification: { state: 'live' },
            },
          ],
        },
      },
    ]);
    await session.setActiveProduct(147, 'Visibilio');

    const text = await (
      await findTool('get_published_feed')
    ).handler({ from: '2026-10-01' }, session);

    expect(Object.fromEntries(new URL(calls[0]!.url).searchParams)).toEqual({
      product_id: '147',
      from: '2026-10-01',
    });
    expect(text).toContain('https://acme.test/why-mcp');
    expect(text).toContain('live');
  });
});
