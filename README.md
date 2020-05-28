# Kuzzle Plugin Sentry

This plugin allows to send the errors encountered by Kuzzle to Sentry for further detailed analysis.

## Installation

First, you have to get the Sentry DSN URL associated with the project you want to monitor.  
Please refer to Sentry [documentation](https://docs.sentry.io/) to create a new Node.js project and get your DSN.  

One you have it, you have to provide the DSN to the plugin using one of the following method.

 - `SENTRY_DSN` environment variable 
 - `plugins.sentry.dsn` key in Kuzzle configuration file

## Usage

This plugin adds a hook on the [request:onError](https://docs.kuzzle.io/core/2/plugins/guides/events/request-on-error/) event triggered by Kuzzle each time a request fail.  

Each error will be enriched with the authenticated user to allow Sentry to compute the number of user affected by an issue. (See [Sentry documentation](https://docs.sentry.io/enriching-error-data/context/?platform=javascript#capturing-the-user))

It will send the error to Sentry alongside with other useful informations like:
 - input payload
 - request context

Finally, is adds a [Sentry tag](https://docs.sentry.io/enriching-error-data/context/?platform=javascript#tagging-events) containing the controller and action name to quickly identify related events.

## Configuration

You can configure the plugin by using [Kuzzle configuration file](https://docs.kuzzle.io/core/2/guides/essentials/configuration/).  

### Sentry environment

It's possible to define the [Sentry environment](https://docs.sentry.io/enriching-error-data/environments/) to bring even more context to catched errors.

You can either provide the `KUZZLE_ENV` environment variable or add the following key to the configuration:

```js

{
  // kuzzle configuration file
  "plugins": {
    "sentry": {
      "environment": "staging"
    }
  }
}
```

### Ignore errors

You can define errors that will be ignored and thus not send to Sentry.  

By default the plugin will only send the `PluginImplementationError`.  

If you add filters manually, then it will send every errors except those matching the filters.

You can filter errors either by [status](https://docs.kuzzle.io/core/2/api/essentials/errors/handling/) or by [id](https://docs.kuzzle.io/core/2/api/essentials/errors/codes/).  

Theses filters can be defined in the configuration file:
```js
{
  // kuzzle configuration file
  "plugins": {
    "sentry": {
      "ignore": {
        "ids": [
          "security.token.verification_error",
          "security.token.expired"
        ],
        "statuses": [ 401, 403 ]
      } 
    }
  }
}
```

### Filter sensitive values

Any sensitive information will be filtered in the Sentry report. This include password and authentication tokens.  

By default, those values are:
 - `context.token._id`: contain the authentication token
 - `context.token.jwt`: authentication token
 - `input.jwt`: authentication token
 - `input.body.password`: password of the `local` strategy

You can add other value to be filtered automatically in the `sensitiveValues` array:

```js
{
  // kuzzle configuration file
  "plugins": {
    "sentry": {
      "sensitiveValues": [
        "input.body.fbkeyid"
      ]
    }
  }
}
```

### Exclude Sentry integrations

You can exclude default Sentry integration by providing their name in the configuration.  

```js
{
  // kuzzle configuration file
  "plugins": {
    "sentry": {
      "excludeIntegrations": [
        "Http",
        "Console"
      ]
    }
  }
}
```

### Configuration example

```js
{
  // kuzzle configuration file
  "plugins": {
    "sentry": {
      // DSN
      "dsn": "https://214284...@sentry.io/214284..."

      // Sentry environment
      "environment": "staging",

      // ignore specific errors
      "ignore": {
        "ids": [
          "security.token.verification_error",
          "security.token.expired"
        ],
        "statuses": [ 401, 403 ]
      },

      // Exclude Sentry default integrations
      "excludeIntegrations": [
        "Http",
        "Console"
      ],

      // Additional sensitives values to filter before sending the error
      "sensitiveValues": [
        "input.body.fbkeyid"
      ]
    }    
  }
}
```

## Extended API

#### admin:switch

This plugin also expose an API method in order to enable or disable sending events to Sentry.

JSON payload:

```json
{
  "controller": "sentry/admin",
  "action": "switch",
  "state": "on"
}
```

HTTP route:

```bash
# enable plugin
curl localhost:7512/_plugin/sentry/switch/on

# disable plugin
curl localhost:7512/_plugin/sentry/switch/off
```

#### send:generic

Sends an error to sentry.

```js
// Example usage in another plugin

this.context.accessors.sdk.query({
  controller: 'sentry/send',
  action: 'request',
  body: {
    error: new Error('failure'),
    tags: {
      tag1: 'gordon',
      tag2: 'alyx'
    },
    extras: {
      some: 'extra data',
      whatever: 'you want'
    },
    request: // Optional errored request
  }
})
```

## Example of Sentry report

![sentry kuzzle](sentry-kuzzle.gif)