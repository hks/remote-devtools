# @himmetkaan/remote-devtools-protocol

Message types, constants and helpers shared by the [Remote DevTools](https://hks.github.io/remote-devtools/) relay, UI
and SDKs: the message envelope, core and module message maps, the field DSL with `validateArgs`, and the JSON Patch
helpers (`diffJson`, `applyPatch`) used by the state module. No dependencies.

You only need this package directly when building tooling around the protocol; the SDK re-exports what apps need.
The full specification is in the [protocol reference](https://hks.github.io/remote-devtools/reference/protocol).

MIT licensed.
