"use client";

const serverNow = Date.now();
let now = serverNow;
let timer = 0;
const listeners = new Set<() => void>();

export function serverClockNow() {
  return serverNow;
}

export function subscribeLiveClock(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    now = Date.now();
    timer = window.setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.clearInterval(timer);
  };
}

export function liveClockNow() {
  return now;
}

export function liveClockListenerCount() {
  return listeners.size;
}
