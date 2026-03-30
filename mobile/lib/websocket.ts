/**
 * Race WebSocket hook — connects to /ws/race and dispatches events to the
 * Zustand store and notification system.
 *
 * Reconnects automatically on disconnect with exponential backoff.
 */

import { useEffect, useRef } from 'react';
import { DEFAULT_API_BASE_URL } from './config';
import { useRaceStore } from '../store/raceStore';
import { notifyRaceControlMessage } from './notifications';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_BASE_URL;
const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';

function getWsUrl(): string {
  const wsBase = BASE_URL.replace(/^http/, 'ws');
  const params = API_KEY ? `?api_key=${API_KEY}` : '';
  return `${wsBase}/ws/race${params}`;
}

interface RcMsg {
  flag?: string;
  category?: string;
  message?: string;
  lap_number?: number;
  date?: string;
}

export function useRaceWebSocket(enabled = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(2000);

  const addAlert = useRaceStore((s) => s.addAlert);
  const setWeather = useRaceStore((s) => s.setWeather);
  const addRaceControlMessage = useRaceStore((s) => s.addRaceControlMessage);

  useEffect(() => {
    if (!enabled) return;

    function connect() {
      try {
        const ws = new WebSocket(getWsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          retryDelay.current = 2000; // Reset backoff on successful connect
        };

        ws.onmessage = (event) => {
          let payload: { type: string; data?: unknown };
          try {
            payload = JSON.parse(event.data);
          } catch {
            return;
          }

          switch (payload.type) {
            case 'race_control': {
              const raw = payload.data;
              const msgs: RcMsg[] = Array.isArray(raw) ? (raw as RcMsg[]) : [];
              for (const msg of msgs) {
                if (!msg || typeof msg !== 'object') continue;
                try {
                  addRaceControlMessage(msg as any);
                } catch {
                  /* ignore bad WS payloads */
                }
                if (
                  msg.flag === 'RED' ||
                  msg.flag === 'CHEQUERED' ||
                  msg.category === 'SafetyCar'
                ) {
                  const alertType =
                    msg.flag === 'RED' ? 'flag' :
                    msg.flag === 'CHEQUERED' ? 'flag' : 'safety_car';
                  try {
                    addAlert({
                      type: alertType,
                      message: msg.message ?? msg.category ?? 'Race control update',
                      timestamp: msg.date ?? new Date().toISOString(),
                    });
                    void notifyRaceControlMessage(msg).catch(() => {});
                  } catch {
                    /* notifications must not crash the app */
                  }
                }
              }
              break;
            }

            case 'weather': {
              if (payload.data != null) {
                try {
                  setWeather(payload.data as any);
                } catch {
                  /* ignore */
                }
              }
              break;
            }

            case 'intervals': {
              // Intervals are polled separately via React Query; WS data is bonus
              break;
            }

            case 'ping':
              break;
          }
        };

        ws.onerror = () => {};  // onclose handles reconnect

        ws.onclose = () => {
          wsRef.current = null;
          // Exponential backoff: 2s → 4s → 8s → max 30s
          retryRef.current = setTimeout(() => {
            retryDelay.current = Math.min(retryDelay.current * 2, 30000);
            connect();
          }, retryDelay.current);
        };
      } catch {
        // WebSocket not supported (e.g. on web in some envs) — silently skip
      }
    }

    connect();

    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [enabled]);
}
