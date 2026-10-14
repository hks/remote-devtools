# Writing a module

Every built-in module uses the same public interface, so you can write your own. A module has a `name`, reports
`capabilities` in the device's `hello`, and talks to the UI with messages in its own namespace, `module.<name>.*`.

```ts
import {defineModule, ModuleError} from '@himmetkaan/remote-devtools';

export function featureTourModule(tour: Tour) {
    return defineModule({
        name: 'tour',

        // Sent with `hello` and again after ctx.updateCapabilities().
        capabilities: () => ({steps: tour.steps.map((s) => s.id)}),

        // Called once when the SDK is enabled; the returned function runs on destroy().
        setup(ctx) {
            // Request / response: the return value (or thrown error) becomes the reply.
            ctx.handle<{stepId: string}>('module.tour.show', ({stepId}) => {
                if (!tour.has(stepId)) throw new ModuleError('UNKNOWN_STEP', `No step "${stepId}"`);
                return tour.show(stepId);
            });

            // Fire-and-forget messages from the UI.
            ctx.on('module.tour.reset', () => tour.reset());

            // Events to the UI. Buffered in `history` while disconnected unless {buffer: false}.
            const off = tour.onStep((step) => ctx.emit('module.tour.step', {stepId: step.id, at: Date.now()}));

            return off;
        },
    });
}
```

## The module context

| Member | Purpose |
|---|---|
| `ctx.emit(type, payload, {buffer?})` | Send an event to the UI |
| `ctx.handle(type, handler)` | Answer a UI request; the result is sent as `module.<name>.result` with `replyTo` |
| `ctx.on(type, listener)` | Listen for UI messages that need no answer |
| `ctx.updateCapabilities()` | Re-send `capabilities()` (for example after registering something) |
| `ctx.storage` | Persistent key-value storage, namespaced to the module |
| `ctx.isConnected()` / `ctx.deviceId` | Connection info |
| `ctx.log` | The SDK logger |

A module can only use its own `module.<name>.` message types. Payloads are serialised safely before sending.

## Showing it in the UI

The relay forwards `module.*` messages without looking at them, so a new module needs no relay changes. The UI only
draws tabs for modules it knows; a module it does not know is listed on the device card. To get a tab without changing
the UI, build it with [custom panels](./panels) instead, or add a UI module to `packages/ui/src/modules` (see
[Development setup](../maintainers/development)).
