import {create} from 'zustand';

export type CommandRun = {
    ok: boolean;
    error: string | null;
    result: unknown;
    at: number;
    durationMs: number;
};

type CommandState = {
    /** commandId → çalışıyor mu */
    running: Record<string, boolean>;
    /** commandId → son sonuç */
    lastRun: Record<string, CommandRun>;
    setRunning(commandId: string, running: boolean): void;
    setResult(commandId: string, run: CommandRun): void;
};

export const useCommandsStore = create<CommandState>((set) => ({
    running: {},
    lastRun: {},
    setRunning: (commandId, running) => set((s) => ({running: {...s.running, [commandId]: running}})),
    setResult: (commandId, run) =>
        set((s) => ({running: {...s.running, [commandId]: false}, lastRun: {...s.lastRun, [commandId]: run}})),
}));
