import {readFileSync} from 'node:fs';
import {mkdir, rename, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {log} from './log.ts';
import type {PersistedSession} from './sessions.ts';

type StateFile = { version: 1; sessions: PersistedSession[] };

/** Dosya yoksa veya okunamıyorsa boş liste döner (relay yine de açılır). */
export function loadState(path: string): PersistedSession[] {
    try {
        const data = JSON.parse(readFileSync(path, 'utf8')) as StateFile;
        return data.version === 1 && Array.isArray(data.sessions) ? data.sessions : [];
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            log.warn('state file could not be read, starting empty', {path, error: (err as Error).message});
        }
        return [];
    }
}

/**
 * Değişiklikleri kısa bir gecikmeyle toplu yazar. Yazım geçici dosya + rename ile atomiktir.
 * Dosya sırlar içerir; sadece sahibi okuyabilir (0600).
 */
export function createStateWriter(path: string, read: () => PersistedSession[], delayMs = 500) {
    let timer: NodeJS.Timeout | null = null;
    let writing: Promise<void> = Promise.resolve();

    async function write() {
        const data: StateFile = {version: 1, sessions: read()};
        const tmp = `${path}.tmp`;
        await mkdir(dirname(path), {recursive: true});
        await writeFile(tmp, JSON.stringify(data), {mode: 0o600});
        await rename(tmp, path);
    }

    function flush(): Promise<void> {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        writing = writing.then(write).catch((err: Error) => log.error('state file write failed', {path, error: err.message}));
        return writing;
    }

    return {
        schedule() {
            if (!timer) timer = setTimeout(() => void flush(), delayMs);
        },
        flush,
    };
}
