/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { TFile } from 'obsidian';
import { strings } from '../../i18n';
import type { CalendarAgendaEvent } from './parseDailyNoteEvents';

interface CalendarAgendaProps {
    events: CalendarAgendaEvent[];
    selectedDayIso: string | null;
    todayIso: string;
    onOpenFile: (file: TFile) => void;
}

function formatDayHeading(dateIso: string): string {
    const date = new Date(`${dateIso}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return dateIso;
    }
    return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}

function formatEventTime(event: CalendarAgendaEvent): string {
    if (event.allDay || !event.startTime) {
        return strings.navigationCalendar.agenda.allDay;
    }
    if (event.endTime) {
        return `${event.startTime}–${event.endTime}`;
    }
    return event.startTime;
}

function monthKeyFromIso(dateIso: string): string {
    return dateIso.slice(0, 7);
}

export const CalendarAgenda = React.memo(function CalendarAgenda({
    events,
    selectedDayIso,
    todayIso,
    onOpenFile
}: CalendarAgendaProps) {
    const scrollTargetRef = useRef<HTMLElement | null>(null);

    const groups = useMemo(() => {
        const byDay = new Map<string, CalendarAgendaEvent[]>();
        for (const event of events) {
            const existing = byDay.get(event.dateIso);
            if (existing) {
                existing.push(event);
            } else {
                byDay.set(event.dateIso, [event]);
            }
        }

        if (todayIso) {
            const todayMonth = monthKeyFromIso(todayIso);
            const todayInLoadedMonth = Array.from(byDay.keys()).some(dateIso => monthKeyFromIso(dateIso) === todayMonth);
            if (todayInLoadedMonth && !byDay.has(todayIso)) {
                byDay.set(todayIso, []);
            }
        }

        if (selectedDayIso && !byDay.has(selectedDayIso)) {
            const selectedMonth = monthKeyFromIso(selectedDayIso);
            const selectedInLoadedMonth = Array.from(byDay.keys()).some(dateIso => monthKeyFromIso(dateIso) === selectedMonth);
            if (selectedInLoadedMonth) {
                byDay.set(selectedDayIso, []);
            }
        }

        return Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [events, selectedDayIso, todayIso]);

    useEffect(() => {
        const targetIso = selectedDayIso ?? todayIso;
        if (!targetIso) {
            return;
        }

        const heading = scrollTargetRef.current;
        if (!heading) {
            return;
        }

        heading.scrollIntoView({ block: 'start', inline: 'nearest' });
    }, [selectedDayIso, todayIso, groups]);

    return (
        <div className="nn-calendar-agenda" role="region" aria-label={strings.navigationCalendar.agenda.title}>
            <div className="nn-calendar-agenda-header">{strings.navigationCalendar.agenda.title}</div>
            {groups.length === 0 ? (
                <div className="nn-calendar-agenda-empty">{strings.navigationCalendar.agenda.empty}</div>
            ) : (
                <div className="nn-calendar-agenda-list">
                    {groups.map(([dateIso, dayEvents]) => {
                        const isToday = dateIso === todayIso;
                        const isSelected = dateIso === selectedDayIso;
                        const isScrollTarget = selectedDayIso ? isSelected : isToday;
                        const classNames = ['nn-calendar-agenda-day'];
                        if (isToday) classNames.push('nn-calendar-agenda-day-today');
                        if (isSelected) classNames.push('nn-calendar-agenda-day-selected');
                        return (
                            <section
                                key={dateIso}
                                ref={isScrollTarget ? scrollTargetRef : undefined}
                                className={classNames.join(' ')}
                            >
                                <h3 className="nn-calendar-agenda-day-heading">{formatDayHeading(dateIso)}</h3>
                                <ul className="nn-calendar-agenda-items">
                                    {dayEvents.map(event => (
                                        <li key={event.id}>
                                            <button
                                                type="button"
                                                className={`nn-calendar-agenda-item${event.file ? '' : ' nn-calendar-agenda-item-no-file'}`}
                                                onClick={() => event.file && onOpenFile(event.file)}
                                                disabled={!event.file}
                                            >
                                                <span className="nn-calendar-agenda-time">{formatEventTime(event)}</span>
                                                <span className="nn-calendar-agenda-title">{event.title}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
});
