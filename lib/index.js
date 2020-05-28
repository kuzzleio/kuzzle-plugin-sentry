const Sentry = require('@sentry/node');
const _ = require('lodash');

class SentryPlugin {
  constructor () {
    this.config = {
      dsn: null,
      environment: 'default',
      ignore: {
        ids: [],
        statuses: [ 401, 403 ]
      },
      excludeIntegrations: [
        "Http",
        "Console"
      ]
    };

    this.context = null;

    this.ready = false;
    this.enabled = true;
  }

  init (config, context) {
    this.config = { ...this.config, ...config};
    this.context = context;

    this.hooks = {
      'request:onError': 'sendRequest'
    };

    this.controllers = {
      send: {
        request: 'sendRequest',
        generic: 'sendGeneric'
      },
      admin: {
        switch: 'switch'
      }
    };

    this.routes = [
      { verb: 'get', url: '/switch/:state', controller: 'admin', action: 'switch' },
    ];

    this._initSentry();
  }

  async switch (request) {
    const state = request.input.args.state;

    this.enabled = state === 'off' ? false : true;

    this.context.log.info(`Sentry plugin is now ${this.enabled ? 'enabled': 'disabled'}`);

    return { enabled: this.enabled };
  }

  _initSentry () {
    const dsn = process.env.SENTRY_DSN || this.config.dsn;

    if (! dsn) {
      this.context.log.warn('Sentry DSN key not found. Set "plugins.sentry.dsn" in kuzzlerc or SENTRY_DSN in env.');

      return;
    }

    const environment = process.env.KUZZLE_ENV || this.config.environment;

    if (! this.config.environment) {
      this.context.log.warn('KUZZLE_ENV or "config.environment" not set. Sentry errors can not be contextualized by environment.');
    }
    Sentry.init({
      dsn,
      environment,
      normalizeDepth: 6,
      beforeSend: this._beforeSend.bind(this),
      integrations: integrations => {
        return integrations.filter(integration => (
          ! this.config.excludeIntegrations.includes(integration.name)
        ));
      }
    });

    this.ready = true;
    this.context.log.info(`Sentry loaded with environment "${environment}"`);
  }

  async sendGeneric (request) {
    const { error, tags, extras, request: originalRequest } = _.get(request, 'input.body', {});

    if (! this.ready || ! this.enabled) {
      return;
    }

    Sentry.withScope(function (scope) {
      scope.setUser({ id: _.get(originalRequest, 'context.user._id') });

      scope.setTag(
        'controller:action',
        `${_.get(originalRequest, 'input.controller')}:${_.get(originalRequest, 'input.action')}`);

      scope.setExtra('requestId', _.get(originalRequest, 'id'));
      scope.setExtra('input', _.get(originalRequest, 'input'));
      scope.setExtra('context', _.get(originalRequest, 'context'));
      scope.setExtra('error', _.get(originalRequest, 'error'));

      for (const [key, value] of Object.entries(tags || {})) {
        scope.setTag(key, value);
      }

      for (const [key, value] of Object.entries(extras || {})) {
        try {
          scope.setExtra(key, JSON.parse(value));
        }
        catch (error) {
          scope.setExtra(key, value);
        }
      }

      scope.setExtra('additionalError', error);

      Sentry.captureException(error);
    });
  }

  async sendRequest (request) {
    if (! this.ready || ! this.enabled) {
      return;
    }

    const errorName = _.get(request, 'error.name');
    if (errorName !== 'PluginImplementationError') {
      return;
    }

    Sentry.withScope(function (scope) {
      scope.setUser({ id: _.get(request, 'context.user._id') });

      scope.setTag(
        'controller:action',
        `${_.get(request, 'input.controller')}:${_.get(request, 'input.action')}`);

      scope.setExtra('requestId', _.get(request, 'id'));
      scope.setExtra('input', _.get(request, 'input'));
      scope.setExtra('context', _.get(request, 'context'));
      scope.setExtra('error', _.get(request, 'error'));

      Sentry.captureException(_.get(request, 'error'));
    });
  }

  _beforeSend (event) {
    // Filter the authentication token
    this._filterExtra(event, 'context.token._id');
    this._filterExtra(event, 'context.token.jwt');
    this._filterExtra(event, 'input.jwt\u200b');

    return event;
  }

  _filterExtra (event, key) {
    if (_.get(event.extra, key)) {
      _.set(event.extra, key, '[Filtered]');
    }
  }
}

module.exports = SentryPlugin;