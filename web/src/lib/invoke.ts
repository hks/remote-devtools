import {COMMANDS} from './commands.ts';
import {relayClient} from './relayClient.ts';
import {useCommandsStore} from '../store/useCommandsStore.ts';
import {useDevtoolsStore} from '../store/useDevtoolsStore.ts';

/** Telefon bu sürede cevap vermezse komut başarısız sayılır. */
const INVOKE_TIMEOUT_MS = 15_000;

type Pending = {commandId: string; startedAt: number; timer: ReturnType<typeof setTimeout>};
const pending = new Map<string, Pending>();

function titleOf(commandId: string): string {
    return COMMANDS.find((c) => c.id === commandId)?.title ?? commandId;
}

function complete(replyTo: string, outcome: {ok: boolean; error: string | null; result: unknown}) {
    const entry = pending.get(replyTo);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(replyTo);

    const durationMs = Date.now() - entry.startedAt;
    useCommandsStore.getState().setResult(entry.commandId, {...outcome, at: Date.now(), durationMs});

    const title = titleOf(entry.commandId);
    const hasResult = outcome.result !== null && outcome.result !== undefined;
    useDevtoolsStore.getState().addLog(
        outcome.ok
            ? {level: 'info', source: 'device', message: `Komut çalıştı: ${title} (${durationMs} ms)`, data: hasResult ? outcome.result : undefined}
            : {level: 'error', source: 'device', message: `Komut başarısız: ${title} — ${outcome.error ?? 'bilinmeyen hata'}`},
    );
}

export function invokeCommand(commandId: string, args: unknown = null): boolean {
    const id = relayClient.send('invoke', {commandId, args});
    if (!id) return false;
    useCommandsStore.getState().setRunning(commandId, true);
    pending.set(id, {
        commandId,
        startedAt: Date.now(),
        timer: setTimeout(() => complete(id, {ok: false, error: 'Zaman aşımı (telefon cevap vermedi)', result: null}), INVOKE_TIMEOUT_MS),
    });
    return true;
}

export function startInvokeIngest() {
    relayClient.subscribe((msg) => {
        if (msg.type === 'invokeResult') {
            complete(msg.payload.replyTo, {ok: msg.payload.ok, error: msg.payload.error, result: msg.payload.result});
        } else if (msg.type === 'error' && msg.payload.replyTo && pending.has(msg.payload.replyTo)) {
            // Cihaz çevrimdışıyken relay DEVICE_OFFLINE döner.
            complete(msg.payload.replyTo, {ok: false, error: msg.payload.message, result: null});
        }
    });
}
