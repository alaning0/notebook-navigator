/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 */

import type { TFile } from 'obsidian';

export interface CalendarAgendaEvent {
    id: string;
    dateIso: string;
    title: string;
    allDay: boolean;
    startTime: string | null;
    endTime: string | null;
    /** File associated with this event. May be null for remote/ICS calendar events. */
    file: TFile | null;
}

const INLINE_FIELD_REGEX = /\[(\w+)::\s*([^\]]*)\]/gu;
const LIST_ITEM_REGEX = /^\s*[-*+]\s+(?:\[(?: |x|X)\]\s+)?(.*)$/u;

function stripInlineFields(text: string): { title: string; fields: Record<string, string> } {
    const fields: Record<string, string> = {};
    const title = text
        .replace(INLINE_FIELD_REGEX, (_match, key: string, value: string) => {
            fields[key] = value.trim();
            return '';
        })
        .replace(/\s+/gu, ' ')
        .trim();
    return { title, fields };
}

function isTruthy(value: string | undefined): boolean {
    if (!value) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === '1';
}

function extractEventsSection(markdown: string): string | null {
    const lines = markdown.split(/\r?\n/u);
    let start = -1;
    for (let index = 0; index < lines.length; index++) {
        if (/^#{1,6}\s+events\s*$/iu.test(lines[index])) {
            start = index + 1;
            break;
        }
    }
    if (start < 0) {
        return null;
    }

    const section: string[] = [];
    for (let index = start; index < lines.length; index++) {
        if (/^#{1,6}\s+/u.test(lines[index])) {
            break;
        }
        section.push(lines[index]);
    }
    return section.join('\n');
}

export function parseDailyNoteEvents(markdown: string, dateIso: string, file: TFile): CalendarAgendaEvent[] {
    const section = extractEventsSection(markdown);
    if (!section) {
        return [];
    }

    const events: CalendarAgendaEvent[] = [];
    const lines = section.split('\n');
    let eventIndex = 0;
    for (const line of lines) {
        const listMatch = LIST_ITEM_REGEX.exec(line);
        if (!listMatch) {
            continue;
        }

        const { title, fields } = stripInlineFields(listMatch[1] ?? '');
        if (!title) {
            continue;
        }

        const startTime = fields.startTime || fields.start || null;
        const endTime = fields.endTime || fields.end || null;
        const allDay = isTruthy(fields.allDay) || (!startTime && !endTime);
        events.push({
            id: `${file.path}::${eventIndex}`,
            dateIso,
            title,
            allDay,
            startTime: allDay ? null : startTime,
            endTime: allDay ? null : endTime,
            file
        });
        eventIndex += 1;
    }
    return events;
}

export function compareAgendaEvents(a: CalendarAgendaEvent, b: CalendarAgendaEvent): number {
    if (a.dateIso !== b.dateIso) {
        return a.dateIso.localeCompare(b.dateIso);
    }
    if (a.allDay !== b.allDay) {
        return a.allDay ? -1 : 1;
    }
    if (a.startTime && b.startTime && a.startTime !== b.startTime) {
        return a.startTime.localeCompare(b.startTime);
    }
    return a.title.localeCompare(b.title);
}
