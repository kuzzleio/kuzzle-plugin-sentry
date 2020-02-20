const Sentry = require('@sentry/node');
const _ = require('lodash');

class SentryPlugin {
  constructor () {
    this.config = null;
    this.context = null;

    this.ready = false;
    this.enabled = false;
  }

  init (config, context) {
    this.config = config;
    this.context = context;

    this.hooks = {
      'request:onError': request => {
        if (this.enabled) {
          this._sendPayload(request);
        }
      }
    };

    this.controllers = {
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
    const { sentry } = this.context.secrets;
    const sentryDsn = process.env.SENTRY_DSN || sentry.dsn;

    if (sentryDsn) {
      Sentry.init({ dsn: sentryDsn, beforeSend: this._beforeSend.bind(this) });
      this.ready = true;
    }
    else {
      this.context.log.warn('Unable to initialize Sentry. Sentry dsn is missing from env (SENTRY_DSN) and Vault (sentry.dsn)');
    }
  }

  _sendPayload (request) {
    if (! this.ready) {
      return;
    }

    // Don't log unauthorized or forbidden errors
    if (request.error.status === 401 || request.error.status === 403) {
      return;
    }

    Sentry.withScope(function (scope) {
      scope.setUser({ id: request.context.user._id });

      scope.setTag(
        'controller:action',
        `${request.input.controller}:${request.input.action}`);

      scope.setExtra('input', request.input);
      scope.setExtra('context', request.context);
      scope.setExtra('error', request.error);

      Sentry.captureException(request.error);
    });
  }

  _beforeSend (event) {
    // Filter the authentication token
    this._filterExtra(event, 'context.token._id');
    this._filterExtra(event, 'context.token.jwt');
    this._filterExtra(event, 'input.jwt\u200b');
  }

  _filterExtra (event, key) {
    if (_.get(event.extra, key)) {
      _.set(event.extra, key, '[Filtered]');
    }
  }
}

module.exports = SentryPlugin;