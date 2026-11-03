'use strict';

const Sentry = require('@sentry/node');

const FILTERED = '[Filtered]';

/**
 * Paths, in the request reported to Sentry, that are always filtered out.
 * The authentication token and the headers are never reported in the first
 * place.
 */
const DEFAULT_SENSITIVE_VALUES = ['input.body.password'];

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function getPath(object, path) {
  let current = object;

  for (const key of path.split('.')) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

/**
 * Returns a copy of `object` with the value at `path` replaced by
 * "[Filtered]". Only the objects along the path are copied, so the request
 * being processed by Kuzzle is never modified.
 */
function filterPath(object, [key, ...rest]) {
  if (!isObject(object) || object[key] === undefined) {
    return object;
  }

  const copy = Array.isArray(object) ? [...object] : { ...object };

  copy[key] = rest.length === 0 ? FILTERED : filterPath(object[key], rest);

  return copy;
}

class SentryPlugin {
  constructor() {
    this.config = {
      dsn: null,
      environment: 'default',
      ignore: {
        ids: [],
        statuses: [],
      },
      excludeIntegrations: ['Http', 'Console'],
      sensitiveValues: [],
    };

    this.context = null;
    this.sentry = Sentry;

    this.ready = false;
    this.enabled = true;
  }

  /**
   * Without any ignore filter, only the errors raised by plugins are reported.
   */
  get sendOnlyPluginErrors() {
    return (
      this.config.ignore.statuses.length === 0 &&
      this.config.ignore.ids.length === 0
    );
  }

  init(config, context) {
    this.config = {
      ...this.config,
      ...config,
      ignore: {
        ids: [],
        statuses: [],
        ...(config && config.ignore),
      },
    };
    this.context = context;

    this.hooks = {
      'request:onError': 'sendRequestError',
    };

    this.controllers = {
      send: {
        generic: 'sendGeneric',
      },
      admin: {
        switch: 'switch',
      },
    };

    this.routes = [
      {
        verb: 'get',
        url: '/switch/:state',
        controller: 'admin',
        action: 'switch',
      },
    ];

    this._initSentry();
  }

  async switch(request) {
    const state = request.input.args.state;

    this.enabled = state !== 'off';

    this.context.log.info(
      `Sentry plugin is now ${this.enabled ? 'enabled' : 'disabled'}`,
    );

    return { enabled: this.enabled };
  }

  _initSentry() {
    const dsn = process.env.SENTRY_DSN || this.config.dsn;

    if (!dsn) {
      this.context.log.warn(
        'Sentry DSN key not found. Set "plugins.sentry.dsn" in kuzzlerc or SENTRY_DSN in env.',
      );

      return;
    }

    const environment = process.env.KUZZLE_ENV || this.config.environment;

    if (!environment) {
      this.context.log.warn(
        'KUZZLE_ENV or "config.environment" not set. Sentry errors can not be contextualized by environment.',
      );
    }

    this.sentry.init({
      dsn,
      environment,
      normalizeDepth: 6,
      integrations: (integrations) =>
        integrations.filter(
          (integration) =>
            !this.config.excludeIntegrations.includes(integration.name),
        ),
    });

    this.ready = true;
    this.context.log.info(`Sentry loaded with environment "${environment}"`);
  }

  /**
   * Hook on `request:onError`: reports the error of a failed API request,
   * unless the configured filters ignore it.
   */
  async sendRequestError(request) {
    const error = request.error;

    if (!this.ready || !this.enabled || !error || this._isIgnored(error)) {
      return;
    }

    this._capture(error, { request: this._describeRequest(request) });
  }

  /**
   * `sentry/send:generic` API action: reports an error sent by another plugin
   * or a client. Always reported: the ignore filters do not apply.
   */
  async sendGeneric(req) {
    const { error, tags, extras, request } = req.input.body || {};

    if (!this.ready || !this.enabled) {
      return { sent: false };
    }

    const eventId = this._capture(this._toError(error), {
      extras,
      request,
      tags,
    });

    return { eventId, sent: true };
  }

  _isIgnored(error) {
    if (this.sendOnlyPluginErrors) {
      return error.name !== 'PluginImplementationError';
    }

    return (
      this.config.ignore.ids.includes(error.id) ||
      this.config.ignore.statuses.includes(error.status)
    );
  }

  /**
   * What the Sentry event tells about the request: what a developer needs to
   * reproduce it, never the authentication token nor the headers.
   */
  _describeRequest(request) {
    const { input, context } = request;

    return {
      context: {
        connection: context.connection && {
          protocol: context.connection.protocol,
        },
        user: context.user && { _id: context.user._id },
      },
      input: {
        action: input.action,
        args: input.args,
        body: input.body,
        controller: input.controller,
        volatile: input.volatile,
      },
      requestId: request.id,
    };
  }

  /**
   * An error sent through the API arrives as JSON, not as an Error instance.
   */
  _toError(error) {
    if (error instanceof Error) {
      return error;
    }

    if (typeof error === 'string') {
      return new Error(error);
    }

    const result = new Error(
      (isObject(error) && error.message) ||
        'Unknown error sent to the Sentry plugin',
    );

    if (isObject(error) && error.name) {
      result.name = error.name;
    }
    if (isObject(error) && error.stack) {
      result.stack = error.stack;
    }

    return result;
  }

  _filterSensitiveValues(request) {
    let filtered = request;

    for (const path of [
      ...DEFAULT_SENSITIVE_VALUES,
      ...this.config.sensitiveValues,
    ]) {
      filtered = filterPath(filtered, path.split('.'));
    }

    return filtered;
  }

  _capture(error, { extras, request, tags }) {
    return this.sentry.withScope((scope) => {
      if (isObject(request)) {
        const userId = getPath(request, 'context.user._id');
        const controller = getPath(request, 'input.controller');
        const action = getPath(request, 'input.action');

        if (userId) {
          scope.setUser({ id: userId });
        }
        if (controller) {
          scope.setTag('controller:action', `${controller}:${action}`);
        }

        scope.setExtra('request', this._filterSensitiveValues(request));
      }

      for (const [key, value] of Object.entries(tags || {})) {
        scope.setTag(key, value);
      }

      for (const [key, value] of Object.entries(extras || {})) {
        try {
          scope.setExtra(key, JSON.parse(value));
        } catch {
          scope.setExtra(key, value);
        }
      }

      return this.sentry.captureException(error);
    });
  }
}

module.exports = SentryPlugin;
