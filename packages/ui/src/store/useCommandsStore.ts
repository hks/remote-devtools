import {create} from 'zustand';

export type CommandRun = {
    ok: boolean;
    error: {code: string; message: string} | null;
    result: unknown;
    at: number;
    durationMs: number;
};

type CommandState = {
    /** `deviceId:commandId` → is running */
    running: Record<string, boolean>;
    /** `deviceId:commandId` → last result */
    lastRun: Record<string, CommandRun>;
    setRunning(key: string, running: boolean): void;
    setResult(key: string, run: CommandRun): void;
};

export const commandKey = (deviceId: string, commandId: string) => `${deviceId}\u0000${commandId}`;

export const useCommandsStore = create<CommandState>((set) => ({
    running: {},
    lastRun: {},
    setRunning: (key, running) => set((s) => ({running: {...s.running, [key]: running}})),
    setResult: (key, run) => set((s) => ({running: {...s.running, [key]: false}, lastRun: {...s.lastRun, [key]: run}})),
}));
