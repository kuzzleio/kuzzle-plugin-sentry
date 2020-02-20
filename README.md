# Kuzzle Plugin Sentry

This plugin allows to send the errors encountered by Kuzzle to Sentry for further detailed analysis.

## Installation

First, you have to get the Sentry DSN secret URL associated with the project you want to monitor.  
Please refer to Sentry [documentation](https://docs.sentry.io/) to create a new Node.js project and get your DSN.  

One you have it, you have to provide the DSN to the plugin using one of the following method.

#### Using the secrets Vault

You can store the DSN inside the [Vault](https://docs.kuzzle.io/core/2/guides/essentials/secrets-vault/) under the key `sentry.dsn`:

```json
{
  "sentry": {
    "dsn": "https://foo42bar21baz84@sentry.io/42424242"
  }
}
```

You can use [kourou](https://github.com/kuzzleio/kourou/#kourou-vaultadd-secrets-file-key-value) to add it directly to a new or existing secrets file:

```bash
$ npm install -g kourou

$ kourou vault:add secrets.enc.json sentry.dsn https://foo42bar21baz84@sentry.io/42424242 --vault-key vault-password
```

#### Using environment variable

You can set the `SENTRY_DSN` environment variable:

## Usage

This plugin adds a hook on the [request:onError](https://docs.kuzzle.io/core/2/plugins/guides/events/request-on-error/) event triggered by Kuzzle each time a request fail.  

Each error will be enriched with the authenticated user to allow Sentry to compute the number of user affected by an issue. (See [Sentry documentation](https://docs.sentry.io/enriching-error-data/context/?platform=javascript#capturing-the-user))

It will send the error to Sentry alongside with other useful informations like:
 - input payload
 - request context

Finally, is adds a [Sentry tag](https://docs.sentry.io/enriching-error-data/context/?platform=javascript#tagging-events) containing the controller and action name to quickly identify related events.

### Extended API

This plugin also expose an API method in order to enable or disable sending events to Sentry.

#### admin:switch

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