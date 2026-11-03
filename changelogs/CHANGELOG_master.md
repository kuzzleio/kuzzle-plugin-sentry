## [1.0.0](https://github.com/kuzzleio/kuzzle-plugin-sentry/compare/v0.2.1...v1.0.0) (2026-11-03)

### ⚠ BREAKING CHANGES

* requires @sentry/node 11, hence Node.js >= 20.19.0.
The sensitiveValues paths now apply to the reported request
(input.body.*, input.args.*...).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

### Bug Fixes

* report request errors to Sentry again, on @sentry/node 11 ([cca78c9](https://github.com/kuzzleio/kuzzle-plugin-sentry/commit/cca78c9a00b2bfb27a95c0a864840def59ae219b))
