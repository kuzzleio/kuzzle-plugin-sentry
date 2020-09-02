const Sentry = require('@sentry/node');
const _ = require('lodash');

class SentryPlugin {
  constructor() {
    this.config = {
      dsn: null,
      environment: 'default',
      ignore: {
        ids: [],
        statuses: []
      },
      excludeIntegrations: [
        "Http",
        "Console"
      ],
      sensitiveValues: []
    };

    this.context = null;

    this.ready = false;
    this.enabled = true;
  }

  get sendOnlyPluginErrors() {
    return this.config.ignore.statuses.length === 0 && this.config.ignore.ids.length === 0
  }

  init(config, context) {
    this.config = { ...this.config, ...config };
    this.context = context;

    this.hooks = {
      'request:onError': 'sendGeneric'
    };

    this.controllers = {
      send: {
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

  async switch(request) {
    const state = request.input.args.state;

    this.enabled = state === 'off' ? false : true;

    this.context.log.info(`Sentry plugin is now ${this.enabled ? 'enabled' : 'disabled'}`);

    return { enabled: this.enabled };
  }

  _initSentry() {
    const dsn = process.env.SENTRY_DSN || this.config.dsn;

    if (!dsn) {
      this.context.log.warn('Sentry DSN key not found. Set "plugins.sentry.dsn" in kuzzlerc or SENTRY_DSN in env.');

      return;
    }

    const environment = process.env.KUZZLE_ENV || this.config.environment;

    if (!this.config.environment) {
      this.context.log.warn('KUZZLE_ENV or "config.environment" not set. Sentry errors can not be contextualized by environment.');
    }
    Sentry.init({
      dsn,
      environment,
      normalizeDepth: 6,
      beforeSend: this._beforeSend.bind(this),
      integrations: integrations => {
        return integrations.filter(integration => (
          !this.config.excludeIntegrations.includes(integration.name)
        ));
      }
    });

    this.ready = true;
    this.context.log.info(`Sentry loaded with environment "${environment}"`);
  }

  async sendGeneric(req) {
    const { error, tags, extras, request } = req.input.body || {};

    if (!this.ready || !this.enabled) {
      return;
    }

    Sentry.withScope(function (scope) {
      if (request) {
        scope.setUser({ id: _.get(request, 'context.user._id') });

        scope.setTag(
          'controller:action',
          `${_.get(request, 'input.controller')}:${_.get(request, 'input.action')}`);

        scope.setExtra('request', request.serialize());
      }

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


      Sentry.captureException(error);
    });
  }

  _beforeSend(event) {
    // Filter the authentication token
    this._filterExtra(event, 'context.token._id');
    this._filterExtra(event, 'context.token.jwt');
    this._filterExtra(event, 'input.jwt\u200b');
    this._filterExtra(event, 'input.body.password');

    for (const sensitiveValue of this.config.sensitiveValues) {
      if (_.get(event, sensitiveValue)) {
        _.set(event, sensitiveValue, '[Filtered');
      }
    }

    return event;
  }

  _filterExtra(event, key) {
    if (_.get(event.extra, key)) {
      _.set(event.extra, key, '[Filtered]');
    }
  }
}

module.exports = SentryPlugin;
