type Fields = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error', msg: string, fields?: Fields) {
    const line = JSON.stringify({t: new Date().toISOString(), level, msg, ...fields});
    if (level === 'error') console.error(line);
    else console.log(line);
}

export const log = {
    info: (msg: string, fields?: Fields) => write('info', msg, fields),
    warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
    error: (msg: string, fields?: Fields) => write('error', msg, fields),
};
