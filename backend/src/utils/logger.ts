import { EventEmitter } from 'events';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    ts: string;
    level: LogLevel;
    component: string;
    event: string;
    cp_id?: string;
    [key: string]: any;
}

class Logger extends EventEmitter {
    private cpId: string | undefined;
    private minLevel: LogLevel = 'debug';
    private levelRank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

    public setCpId(cpId: string): void {
        this.cpId = cpId;
    }

    public setMinLevel(level: LogLevel): void {
        this.minLevel = level;
    }

    public log(level: LogLevel, component: string, event: string, fields: Record<string, any> = {}): void {
        if (this.levelRank[level] < this.levelRank[this.minLevel]) return;

        const entry: LogEntry = {
            ts: new Date().toISOString(),
            level,
            component,
            event,
            cp_id: this.cpId,
            ...fields,
        };

        const line = JSON.stringify(entry);
        if (level === 'error') process.stderr.write(line + '\n');
        else process.stdout.write(line + '\n');

        this.emit('entry', entry);
    }

    public debug(component: string, event: string, fields: Record<string, any> = {}): void {
        this.log('debug', component, event, fields);
    }
    public info(component: string, event: string, fields: Record<string, any> = {}): void {
        this.log('info', component, event, fields);
    }
    public warn(component: string, event: string, fields: Record<string, any> = {}): void {
        this.log('warn', component, event, fields);
    }
    public error(component: string, event: string, fields: Record<string, any> = {}): void {
        this.log('error', component, event, fields);
    }
}

export const logger = new Logger();
