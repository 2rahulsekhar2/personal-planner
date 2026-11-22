"use client";
import { useCallback } from "react";
import { createPortal } from "react-dom";
import { DateTime } from "luxon";
import { useDismiss } from "./useDismiss";

/** A pressed stretch of free time: its day, its hours as HH:mm, and where on screen it was pressed. */
export interface Slot { iso: string; start: string; end: string; x: number; y: number }

const clock = (hhmm: string) => {
  const t = DateTime.fromFormat(hhmm, "HH:mm");
  return t.toFormat(t.minute ? "h:mm a" : "h a");
};

// Appointment or task? Asked where the free time was pressed, by the Week grid and the Day list alike.
// Drawn at the pointer and outside the page flow, so a scrolling parent cannot clip it.
export default function SlotMenu({ slot, onAppointment, onTask, onClose }: { slot: Slot; onAppointment: () => void; onTask: () => void; onClose: () => void }) {
  const ref = useDismiss(true, useCallback(onClose, [onClose]));
  const day = DateTime.fromISO(slot.iso);
  return createPortal(
    <div
      ref={ref} className="pop-menu slot-menu" role="menu"
      aria-label={`Add at ${clock(slot.start)}, ${day.toFormat("cccc d LLLL")}`}
      style={{ left: Math.max(8, Math.min(slot.x + 10, window.innerWidth - 268)), top: Math.max(8, Math.min(slot.y + 10, window.innerHeight - 170)) }}
    >
      <p className="slot-when">{day.toFormat("ccc d LLL")}, {clock(slot.start)}</p>
      <div className="add-primary">
        <button className="add-tile" role="menuitem" autoFocus onClick={onAppointment}>
          <span className="add-icon" aria-hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M8 2.5v4M16 2.5v4M3 9.5h18" /></svg></span>
          <span className="add-label">Appointment</span>
          <span className="add-hint">{clock(slot.start)} to {clock(slot.end)}</span>
        </button>
        <button className="add-tile" role="menuitem" onClick={onTask}>
          <span className="add-icon" aria-hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><path d="M8 12.5l2.8 2.8L16 9.5" /></svg></span>
          <span className="add-label">Task</span>
          <span className="add-hint">Due {clock(slot.start)}</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
