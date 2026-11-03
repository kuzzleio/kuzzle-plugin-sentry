'use strict';

const assert = require('node:assert/strict');
const { beforeEach, describe, it, mock } = require('node:test');

const SentryPlugin = require('../lib');

function fakeSentry() {
  const scope = {
    setExtra: mock.fn(),
    setTag: mock.fn(),
    setUser: mock.fn(),
  };

  return {
    captureException: mock.fn(() => 'event-id'),
    init: mock.fn(),
    scope,
    withScope: mock.fn((callback) => callback(scope)),
  };
}

function fakeContext() {
  return {
    log: { info: mock.fn(), warn: mock.fn() },
  };
}

function kuzzleError(name, { id, status } = {}) {
  const error = new Error('failure');
  error.name = name;
  error.id = id;
  error.status = status;
  return error;
}

function failedRequest(error, body = {}) {
  return {
    context: {
      connection: { id: 'connection-id', protocol: 'http' },
      token: { _id: 'token-id', jwt: 'secret-jwt' },
      user: { _id: 'user-id' },
    },
    error,
    id: 'request-id',
    input: {
      action: 'create',
      args: { collection: 'collection', index: 'index' },
      body,
      controller: 'document',
      headers: { authorization: 'Bearer secret-jwt' },
      jwt: 'secret-jwt',
      volatile: {},
    },
  };
}

function setup(config = {}) {
  const plugin = new SentryPlugin();
  const sentry = fakeSentry();

  plugin.sentry = sentry;
  plugin.init({ dsn: 'https://key@sentry.example/1', ...config }, fakeContext());

  return { plugin, sentry };
}

describe('SentryPlugin', () => {
  beforeEach(() => {
    delete process.env.SENTRY_DSN;
    delete process.env.KUZZLE_ENV;
  });

  describe('#init', () => {
    it('does not start Sentry without a DSN', () => {
      const plugin = new SentryPlugin();
      const context = fakeContext();
      plugin.sentry = fakeSentry();

      plugin.init({}, context);

      assert.equal(plugin.sentry.init.mock.callCount(), 0);
      assert.equal(plugin.ready, false);
      assert.equal(context.log.warn.mock.callCount(), 1);
    });

    it('starts Sentry with the DSN and environment of the configuration', () => {
      const { plugin, sentry } = setup({ environment: 'staging' });
      const options = sentry.init.mock.calls[0].arguments[0];

      assert.equal(plugin.ready, true);
      assert.equal(options.dsn, 'https://key@sentry.example/1');
      assert.equal(options.environment, 'staging');
    });

    it('prefers the SENTRY_DSN and KUZZLE_ENV environment variables', () => {
      process.env.SENTRY_DSN = 'https://env@sentry.example/2';
      process.env.KUZZLE_ENV = 'production';

      const { sentry } = setup({ environment: 'staging' });
      const options = sentry.init.mock.calls[0].arguments[0];

      assert.equal(options.dsn, 'https://env@sentry.example/2');
      assert.equal(options.environment, 'production');
    });

    it('removes the excluded integrations', () => {
      const { sentry } = setup({ excludeIntegrations: ['Http'] });
      const { integrations } = sentry.init.mock.calls[0].arguments[0];

      assert.deepEqual(
        integrations([{ name: 'Http' }, { name: 'Console' }]),
        [{ name: 'Console' }],
      );
    });

    it('keeps the default ignore lists when only one is configured', () => {
      const { plugin } = setup({ ignore: { statuses: [401] } });

      assert.deepEqual(plugin.config.ignore, { ids: [], statuses: [401] });
    });
  });

  describe('#sendRequestError', () => {
    it('reports only the plugin errors when no filter is configured', async () => {
      const { plugin, sentry } = setup();

      await plugin.sendRequestError(failedRequest(kuzzleError('NotFoundError')));
      assert.equal(sentry.captureException.mock.callCount(), 0);

      const error = kuzzleError('PluginImplementationError');
      await plugin.sendRequestError(failedRequest(error));

      assert.equal(sentry.captureException.mock.callCount(), 1);
      assert.equal(sentry.captureException.mock.calls[0].arguments[0], error);
    });

    it('reports every error but the ignored ids and statuses', async () => {
      const { plugin, sentry } = setup({
        ignore: { ids: ['security.token.expired'], statuses: [403] },
      });

      await plugin.sendRequestError(
        failedRequest(
          kuzzleError('UnauthorizedError', { id: 'security.token.expired' }),
        ),
      );
      await plugin.sendRequestError(
        failedRequest(kuzzleError('ForbiddenError', { status: 403 })),
      );
      assert.equal(sentry.captureException.mock.callCount(), 0);

      await plugin.sendRequestError(
        failedRequest(kuzzleError('NotFoundError', { status: 404 })),
      );
      assert.equal(sentry.captureException.mock.callCount(), 1);
    });

    it('adds the user, the controller:action tag and the request', async () => {
      const { plugin, sentry } = setup();

      await plugin.sendRequestError(
        failedRequest(kuzzleError('PluginImplementationError'), { foo: 'bar' }),
      );

      const { scope } = sentry;
      assert.deepEqual(scope.setUser.mock.calls[0].arguments, [
        { id: 'user-id' },
      ]);
      assert.deepEqual(scope.setTag.mock.calls[0].arguments, [
        'controller:action',
        'document:create',
      ]);

      const [key, request] = scope.setExtra.mock.calls[0].arguments;
      assert.equal(key, 'request');
      assert.deepEqual(request, {
        context: {
          connection: { protocol: 'http' },
          user: { _id: 'user-id' },
        },
        input: {
          action: 'create',
          args: { collection: 'collection', index: 'index' },
          body: { foo: 'bar' },
          controller: 'document',
          volatile: {},
        },
        requestId: 'request-id',
      });
    });

    it('never reports the token nor the headers, and filters the password and the sensitive values', async () => {
      const { plugin, sentry } = setup({
        sensitiveValues: ['input.body.secret.key', 'input.body.missing'],
      });
      const body = { password: 'p4ss', secret: { key: 'k3y', other: 'ok' } };

      await plugin.sendRequestError(
        failedRequest(kuzzleError('PluginImplementationError'), body),
      );

      const request = sentry.scope.setExtra.mock.calls[0].arguments[1];
      const serialized = JSON.stringify(request);

      assert.equal(serialized.includes('secret-jwt'), false);
      assert.equal(serialized.includes('token-id'), false);
      assert.deepEqual(request.input.body, {
        password: '[Filtered]',
        secret: { key: '[Filtered]', other: 'ok' },
      });
      // the request processed by Kuzzle is left untouched
      assert.deepEqual(body, {
        password: 'p4ss',
        secret: { key: 'k3y', other: 'ok' },
      });
    });

    it('does nothing when disabled or not started', async () => {
      const { plugin, sentry } = setup();
      const request = failedRequest(kuzzleError('PluginImplementationError'));

      await plugin.switch({ input: { args: { state: 'off' } } });
      await plugin.sendRequestError(request);

      plugin.enabled = true;
      plugin.ready = false;
      await plugin.sendRequestError(request);

      assert.equal(sentry.captureException.mock.callCount(), 0);
    });
  });

  describe('#sendGeneric', () => {
    it('reports the error sent through the API with its tags and extras', async () => {
      const { plugin, sentry } = setup();

      const result = await plugin.sendGeneric({
        input: {
          body: {
            error: { message: 'failure', name: 'CustomError' },
            extras: { json: '{"a":1}', text: 'not json' },
            tags: { tag1: 'value' },
          },
        },
      });

      assert.deepEqual(result, { eventId: 'event-id', sent: true });

      const error = sentry.captureException.mock.calls[0].arguments[0];
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'failure');
      assert.equal(error.name, 'CustomError');

      const { scope } = sentry;
      assert.deepEqual(scope.setTag.mock.calls[0].arguments, ['tag1', 'value']);
      assert.deepEqual(scope.setExtra.mock.calls[0].arguments, ['json', { a: 1 }]);
      assert.deepEqual(scope.setExtra.mock.calls[1].arguments, [
        'text',
        'not json',
      ]);
    });

    it('accepts an error message and a plain request object', async () => {
      const { plugin, sentry } = setup();

      await plugin.sendGeneric({
        input: {
          body: {
            error: 'failure',
            request: {
              input: { action: 'search', body: { password: 'p4ss' }, controller: 'document' },
            },
          },
        },
      });

      assert.equal(
        sentry.captureException.mock.calls[0].arguments[0].message,
        'failure',
      );
      assert.deepEqual(sentry.scope.setTag.mock.calls[0].arguments, [
        'controller:action',
        'document:search',
      ]);
      assert.deepEqual(sentry.scope.setExtra.mock.calls[0].arguments[1], {
        input: {
          action: 'search',
          body: { password: '[Filtered]' },
          controller: 'document',
        },
      });
    });

    it('ignores the error filters', async () => {
      const { plugin, sentry } = setup();

      await plugin.sendGeneric({ input: { body: { error: 'failure' } } });

      assert.equal(sentry.captureException.mock.callCount(), 1);
    });

    it('reports nothing when disabled', async () => {
      const { plugin, sentry } = setup();

      await plugin.switch({ input: { args: { state: 'off' } } });
      const result = await plugin.sendGeneric({
        input: { body: { error: 'failure' } },
      });

      assert.deepEqual(result, { sent: false });
      assert.equal(sentry.captureException.mock.callCount(), 0);
    });
  });

  describe('#switch', () => {
    it('enables and disables the reporting', async () => {
      const { plugin } = setup();

      assert.deepEqual(
        await plugin.switch({ input: { args: { state: 'off' } } }),
        { enabled: false },
      );
      assert.deepEqual(
        await plugin.switch({ input: { args: { state: 'on' } } }),
        { enabled: true },
      );
    });
  });
});
