/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 *
 * Adapter for reading events from the Full Calendar plugin (obsidian-full-calendar).
 * When Full Calendar is loaded, this adapter reads its event cache to populate the
 * Calendar Agenda instead of parsing daily notes directly.
 */

import { TFile, type App } from 'obsidian';
import type { CalendarAgendaEvent } from './parseDailyNoteEvents';

const FULL_CALENDAR_PLUGIN_ID = 'obsidian-full-calendar';

/**
 * OFCEvent types from Full Calendar plugin.
 * Single events have a date (and optional endDate for multi-day).
 * Recurring events repeat on specified days of the week.
 * RRule events use iCalendar recurrence rules.
 */
interface OFCEventSingle {
    type: 'single';
    title: string;
    id?: string;
    date: string;
    endDate?: string | null;
    completed?: string | false | null;
    allDay: boolean;
    startTime?: string;
    endTime?: string | null;
}

interface OFCEventRecurring {
    type: 'recurring';
    title: string;
    id?: string;
    daysOfWeek: ('U' | 'M' | 'T' | 'W' | 'R' | 'F' | 'S')[];
    startRecur?: string;
    endRecur?: string;
    allDay: boolean;
    startTime?: string;
    endTime?: string | null;
}

interface OFCEventRRule {
    type: 'rrule';
    title: string;
    id?: string;
    startDate: string;
    rrule: string;
    skipDates: string[];
    allDay: boolean;
    startTime?: string;
    endTime?: string | null;
}

type OFCEvent = OFCEventSingle | OFCEventRecurring | OFCEventRRule;

interface CachedEvent {
    event: OFCEvent;
    id: string;
}

interface OFCEventSource {
    events: CachedEvent[];
    editable: boolean;
    color: string;
    id: string;
}

interface EventLocation {
    path: string;
    lineNumber: number | undefined;
}

type UpdateViewCallback = (info: { type: string }) => void;

interface EventCache {
    getAllEvents(): OFCEventSource[];
    getInfoForEditableEvent(eventId: string): { location: EventLocation } | null;
    isEventEditable(eventId: string): boolean;
    on(eventType: 'update', callback: UpdateViewCallback): UpdateViewCallback;
    off(eventType: 'update', callback: UpdateViewCallback): void;
    initialized: boolean;
    populate(): Promise<void>;
}

interface FullCalendarPlugin {
    cache: EventCache;
}

interface ObsidianAppWithPlugins extends App {
    plugins?: {
        plugins?: Record<string, unknown>;
    };
}

/**
 * Get the Full Calendar plugin instance if it's loaded and enabled.
 */
export function getFullCalendarPlugin(app: App): FullCalendarPlugin | null {
    const appWithPlugins = app as ObsidianAppWithPlugins;
    const plugins = appWithPlugins.plugins?.plugins;
    if (!plugins) {
        return null;
    }
    const fcPlugin = plugins[FULL_CALENDAR_PLUGIN_ID];
    if (!fcPlugin || typeof fcPlugin !== 'object' || !('cache' in fcPlugin)) {
        return null;
    }
    return fcPlugin as FullCalendarPlugin;
}

/**
 * Check if Full Calendar plugin is available and has events.
 */
export function isFullCalendarAvailable(app: App): boolean {
    const plugin = getFullCalendarPlugin(app);
    return plugin !== null && plugin.cache.initialized;
}

/**
 * Map day-of-week letter to JS day number (0=Sunday, 1=Monday, etc.)
 */
const DAY_LETTER_TO_NUMBER: Record<string, number> = {
    U: 0, // Sunday
    M: 1,
    T: 2,
    W: 3,
    R: 4, // Thursday
    F: 5,
    S: 6
};

/**
 * Parse ISO date string to get year, month, day.
 */
function parseIsoDate(dateStr: string): { year: number; month: number; day: number } | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
    if (!match) {
        return null;
    }
    return {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10)
    };
}

/**
 * Format date parts as ISO date string.
 */
function formatIsoDate(year: number, month: number, day: number): string {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Get all dates in a month as ISO strings.
 */
function getDatesInMonth(yearMonth: string): string[] {
    const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
    if (!match) {
        return [];
    }
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dates: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
        dates.push(formatIsoDate(year, month, day));
    }
    return dates;
}

/**
 * Check if a date string is within a month (YYYY-MM format).
 */
function isDateInMonth(dateIso: string, yearMonth: string): boolean {
    return dateIso.startsWith(yearMonth);
}

/**
 * Check if a date falls on one of the specified days of week.
 */
function isDateOnDaysOfWeek(dateIso: string, daysOfWeek: string[]): boolean {
    const parsed = parseIsoDate(dateIso);
    if (!parsed) {
        return false;
    }
    const date = new Date(parsed.year, parsed.month - 1, parsed.day);
    const dayOfWeek = date.getDay();
    return daysOfWeek.some(letter => DAY_LETTER_TO_NUMBER[letter] === dayOfWeek);
}

/**
 * Check if a date is within optional start/end recurrence bounds.
 */
function isDateInRecurrenceRange(dateIso: string, startRecur?: string, endRecur?: string): boolean {
    if (startRecur && dateIso < startRecur) {
        return false;
    }
    if (endRecur && dateIso > endRecur) {
        return false;
    }
    return true;
}

/**
 * Try to resolve the file for an event if the location is available.
 * For editable events (daily notes, local calendars), FC stores the file path.
 */
function resolveEventFile(
    app: App,
    cache: EventCache,
    eventId: string
): TFile | null {
    try {
        if (!cache.isEventEditable(eventId)) {
            return null;
        }
        const info = cache.getInfoForEditableEvent(eventId);
        if (!info?.location?.path) {
            return null;
        }
        const abstractFile = app.vault.getAbstractFileByPath(info.location.path);
        if (abstractFile instanceof TFile) {
            return abstractFile;
        }
    } catch {
        // Event may not be editable or may not exist
    }
    return null;
}

/**
 * Expand a single event into agenda events.
 * Multi-day events are expanded into one row per day for clarity.
 */
function expandSingleEvent(
    event: OFCEventSingle,
    eventId: string,
    yearMonth: string,
    file: TFile | null
): CalendarAgendaEvent[] {
    const results: CalendarAgendaEvent[] = [];
    const startParsed = parseIsoDate(event.date);
    if (!startParsed) {
        return results;
    }
    
    const startDateIso = event.date.slice(0, 10);
    const endDateIso = event.endDate?.slice(0, 10) ?? startDateIso;
    
    // Generate events for each day in the range that falls within the month
    const currentDate = new Date(startParsed.year, startParsed.month - 1, startParsed.day);
    const endParsed = parseIsoDate(endDateIso);
    const endDate = endParsed 
        ? new Date(endParsed.year, endParsed.month - 1, endParsed.day)
        : currentDate;
    
    let dayIndex = 0;
    while (currentDate <= endDate) {
        const currentIso = formatIsoDate(
            currentDate.getFullYear(),
            currentDate.getMonth() + 1,
            currentDate.getDate()
        );
        
        if (isDateInMonth(currentIso, yearMonth)) {
            const isMultiDay = startDateIso !== endDateIso;
            const isFirstDay = currentIso === startDateIso;
            const isLastDay = currentIso === endDateIso;
            
            // For multi-day events, show time only on appropriate days
            const showStartTime = isFirstDay && !event.allDay;
            const showEndTime = isLastDay && !event.allDay && event.endTime;
            
            // Create title suffix for multi-day events
            let title = event.title;
            if (isMultiDay) {
                if (isFirstDay && isLastDay) {
                    // Single day selected from multi-day range - shouldn't happen
                } else if (isFirstDay) {
                    title = `${event.title} (starts)`;
                } else if (isLastDay) {
                    title = `${event.title} (ends)`;
                } else {
                    title = `${event.title} (cont.)`;
                }
            }
            
            results.push({
                id: `fc::${eventId}::${dayIndex}`,
                dateIso: currentIso,
                title,
                allDay: event.allDay || (!showStartTime && !showEndTime),
                startTime: showStartTime && event.startTime ? event.startTime : null,
                endTime: showEndTime && event.endTime ? event.endTime : null,
                file
            });
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
        dayIndex++;
    }
    
    return results;
}

/**
 * Expand a recurring event into agenda events for the visible month.
 */
function expandRecurringEvent(
    event: OFCEventRecurring,
    eventId: string,
    yearMonth: string,
    file: TFile | null
): CalendarAgendaEvent[] {
    const results: CalendarAgendaEvent[] = [];
    const datesInMonth = getDatesInMonth(yearMonth);
    
    let occurrenceIndex = 0;
    for (const dateIso of datesInMonth) {
        if (!isDateOnDaysOfWeek(dateIso, event.daysOfWeek)) {
            continue;
        }
        if (!isDateInRecurrenceRange(dateIso, event.startRecur, event.endRecur)) {
            continue;
        }
        
        results.push({
            id: `fc::${eventId}::r${occurrenceIndex}`,
            dateIso,
            title: event.title,
            allDay: event.allDay,
            startTime: event.allDay ? null : (event.startTime ?? null),
            endTime: event.allDay ? null : (event.endTime ?? null),
            file
        });
        occurrenceIndex++;
    }
    
    return results;
}

/**
 * Expand an rrule event into agenda events for the visible month.
 * This is a simplified expansion that handles basic weekly/daily patterns.
 * Complex rrules are shown only on their start date with a note.
 */
function expandRRuleEvent(
    event: OFCEventRRule,
    eventId: string,
    yearMonth: string,
    file: TFile | null
): CalendarAgendaEvent[] {
    const results: CalendarAgendaEvent[] = [];
    const skipSet = new Set(event.skipDates.map(d => d.slice(0, 10)));
    
    // Parse the rrule to extract basic patterns
    const rrule = event.rrule.toUpperCase();
    const freqMatch = /FREQ=(\w+)/.exec(rrule);
    const freq = freqMatch?.[1];
    
    const bydayMatch = /BYDAY=([^;]+)/.exec(rrule);
    const intervalMatch = /INTERVAL=(\d+)/.exec(rrule);
    const countMatch = /COUNT=(\d+)/.exec(rrule);
    const untilMatch = /UNTIL=(\d{8})/.exec(rrule);
    
    const interval = intervalMatch ? parseInt(intervalMatch[1], 10) : 1;
    const count = countMatch ? parseInt(countMatch[1], 10) : null;
    const until = untilMatch ? `${untilMatch[1].slice(0, 4)}-${untilMatch[1].slice(4, 6)}-${untilMatch[1].slice(6, 8)}` : null;
    
    const startParsed = parseIsoDate(event.startDate);
    if (!startParsed) {
        return results;
    }
    
    const datesInMonth = getDatesInMonth(yearMonth);
    let occurrenceCount = 0;
    
    if (freq === 'WEEKLY' && bydayMatch) {
        // Weekly recurrence on specific days
        const byDayLetters = bydayMatch[1].split(',').map(d => {
            // Convert MO, TU, WE, TH, FR, SA, SU to U, M, T, W, R, F, S
            const dayMap: Record<string, string> = { SU: 'U', MO: 'M', TU: 'T', WE: 'W', TH: 'R', FR: 'F', SA: 'S' };
            return dayMap[d.trim()] ?? d.trim();
        });
        
        for (const dateIso of datesInMonth) {
            if (dateIso < event.startDate.slice(0, 10)) continue;
            if (until && dateIso > until) continue;
            if (skipSet.has(dateIso)) continue;
            if (count && occurrenceCount >= count) break;
            
            if (isDateOnDaysOfWeek(dateIso, byDayLetters)) {
                results.push({
                    id: `fc::${eventId}::rr${occurrenceCount}`,
                    dateIso,
                    title: event.title,
                    allDay: event.allDay,
                    startTime: event.allDay ? null : (event.startTime ?? null),
                    endTime: event.allDay ? null : (event.endTime ?? null),
                    file
                });
                occurrenceCount++;
            }
        }
    } else if (freq === 'DAILY') {
        // Daily recurrence
        const currentDate = new Date(startParsed.year, startParsed.month - 1, startParsed.day);
        
        for (const dateIso of datesInMonth) {
            if (dateIso < event.startDate.slice(0, 10)) continue;
            if (until && dateIso > until) continue;
            if (skipSet.has(dateIso)) continue;
            if (count && occurrenceCount >= count) break;
            
            // Check if this date matches the interval
            const dateParsed = parseIsoDate(dateIso);
            if (dateParsed) {
                const checkDate = new Date(dateParsed.year, dateParsed.month - 1, dateParsed.day);
                const daysDiff = Math.floor((checkDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
                if (daysDiff >= 0 && daysDiff % interval === 0) {
                    results.push({
                        id: `fc::${eventId}::rr${occurrenceCount}`,
                        dateIso,
                        title: event.title,
                        allDay: event.allDay,
                        startTime: event.allDay ? null : (event.startTime ?? null),
                        endTime: event.allDay ? null : (event.endTime ?? null),
                        file
                    });
                    occurrenceCount++;
                }
            }
        }
    } else {
        // For complex rrules, just show on start date if it's in the month
        const startDateIso = event.startDate.slice(0, 10);
        if (isDateInMonth(startDateIso, yearMonth) && !skipSet.has(startDateIso)) {
            results.push({
                id: `fc::${eventId}::rr0`,
                dateIso: startDateIso,
                title: `${event.title} (recurring)`,
                allDay: event.allDay,
                startTime: event.allDay ? null : (event.startTime ?? null),
                endTime: event.allDay ? null : (event.endTime ?? null),
                file
            });
        }
    }
    
    return results;
}

/**
 * Get all events from Full Calendar for a given month.
 * Returns events mapped to CalendarAgendaEvent format.
 */
export function getFullCalendarEventsForMonth(
    app: App,
    yearMonth: string
): CalendarAgendaEvent[] {
    const plugin = getFullCalendarPlugin(app);
    if (!plugin) {
        return [];
    }
    
    const cache = plugin.cache;
    if (!cache.initialized) {
        return [];
    }
    
    const sources = cache.getAllEvents();
    const results: CalendarAgendaEvent[] = [];
    
    for (const source of sources) {
        for (const cached of source.events) {
            const { event, id: eventId } = cached;
            const file = resolveEventFile(app, cache, eventId);
            
            switch (event.type) {
                case 'single':
                    results.push(...expandSingleEvent(event, eventId, yearMonth, file));
                    break;
                case 'recurring':
                    results.push(...expandRecurringEvent(event, eventId, yearMonth, file));
                    break;
                case 'rrule':
                    results.push(...expandRRuleEvent(event, eventId, yearMonth, file));
                    break;
            }
        }
    }
    
    return results;
}

/**
 * Subscribe to Full Calendar cache updates.
 * Returns an unsubscribe function.
 */
export function subscribeToFullCalendarUpdates(
    app: App,
    callback: () => void
): (() => void) | null {
    const plugin = getFullCalendarPlugin(app);
    if (!plugin) {
        return null;
    }
    
    const cache = plugin.cache;
    const updateHandler: UpdateViewCallback = (info) => {
        // Trigger refresh on any cache update
        callback();
    };
    
    cache.on('update', updateHandler);
    
    return () => {
        cache.off('update', updateHandler);
    };
}

/**
 * Ensure the Full Calendar cache is populated.
 * Call this on initial load to make sure events are available.
 */
export async function ensureFullCalendarPopulated(app: App): Promise<void> {
    const plugin = getFullCalendarPlugin(app);
    if (!plugin) {
        return;
    }
    
    const cache = plugin.cache;
    if (!cache.initialized) {
        await cache.populate();
    }
}
