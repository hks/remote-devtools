import type {HistoryEntry} from '@himmetkaan/remote-devtools-protocol';

/** Fixed-size ring buffer for messages sent before connecting; when full, the oldest is dropped. */
export class HistoryBuffer {
    readonly #max: number;
    #entries: HistoryEntry[] = [];

    constructor(maxEntries: number) {
        this.#max = Math.max(0, maxEntries);
    }

    get size(): number {
        return this.#entries.length;
    }

    push(entry: HistoryEntry): void {
        if (this.#max === 0) return;
        this.#entries.push(entry);
        if (this.#entries.length > this.#max) this.#entries.splice(0, this.#entries.length - this.#max);
    }

    /** Empties the buffer and returns its contents split into chunks of roughly at most `maxBytes` each. */
    drain(maxBytes: number): HistoryEntry[][] {
        const chunks: HistoryEntry[][] = [];
        let current: HistoryEntry[] = [];
        let size = 0;
        for (const entry of this.#entries) {
            const entrySize = JSON.stringify(entry).length;
            if (current.length > 0 && size + entrySize > maxBytes) {
                chunks.push(current);
                current = [];
                size = 0;
            }
            current.push(entry);
            size += entrySize;
        }
        if (current.length) chunks.push(current);
        this.#entries = [];
        return chunks;
    }
}
