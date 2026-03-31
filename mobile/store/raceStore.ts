/**
 * Global Zustand store — race session state, alerts, and user preferences.
 */

import { create } from 'zustand';
import type { Driver, RaceControlMsg, Session, SessionEntry, Weather } from '../lib/api';

interface Alert {
  id: string;
  type: 'flag' | 'pit' | 'safety_car' | 'drs' | 'overtake' | 'fastest_lap';
  message: string;
  timestamp: string;
  driverNumber?: number;
  read: boolean;
}

export type SelectedSessionKey = number | 'latest' | 'pending';

function initialSelectedSessionKey(): SelectedSessionKey {
  const v = process.env.EXPO_PUBLIC_HISTORICAL_ONLY;
  if (v === 'false' || v === '0') return 'latest';
  return 'pending';
}

interface RaceState {
  // Session
  currentSession: Session | null;
  setCurrentSession: (s: Session) => void;

  // Session picker (shared across all data screens)
  selectedSessionKey: SelectedSessionKey;
  setSelectedSessionKey: (key: SelectedSessionKey) => void;

  // Full session entry for the selected session (set by SessionPicker)
  selectedSessionInfo: SessionEntry | null;
  setSelectedSessionInfo: (info: SessionEntry | null) => void;

  /**
   * Season year last chosen in the session picker (historical mode). Drives
   * GET /history/finished_default_session?year=… when selection is reset to pending.
   */
  historicalBrowseYear: string | null;
  setHistoricalBrowseYear: (y: string | null) => void;

  // Drivers
  drivers: Driver[];
  setDrivers: (d: Driver[]) => void;
  updateDriver: (driverNumber: number, patch: Partial<Driver>) => void;

  // Weather
  weather: Weather | null;
  setWeather: (w: Weather) => void;

  // Race control
  raceControlMessages: RaceControlMsg[];
  addRaceControlMessage: (msg: RaceControlMsg) => void;

  // Alerts
  alerts: Alert[];
  addAlert: (alert: Omit<Alert, 'id' | 'read'>) => void;
  markAlertRead: (id: string) => void;
  clearAlerts: () => void;
  unreadCount: () => number;

  // Selected driver (for detail views)
  selectedDriverNumber: number | null;
  setSelectedDriver: (n: number | null) => void;

  // Preferences
  favoriteDriverNumber: number | null;
  setFavoriteDriver: (n: number | null) => void;

  // Live tracking toggle
  isLiveTracking: boolean;
  setLiveTracking: (v: boolean) => void;
}

let alertIdCounter = 0;

export const useRaceStore = create<RaceState>((set, get) => ({
  currentSession: null,
  setCurrentSession: (currentSession) => set({ currentSession }),

  selectedSessionKey: initialSelectedSessionKey(),
  setSelectedSessionKey: (selectedSessionKey) => set({ selectedSessionKey }),

  selectedSessionInfo: null,
  setSelectedSessionInfo: (selectedSessionInfo) => set({ selectedSessionInfo }),

  historicalBrowseYear: null,
  setHistoricalBrowseYear: (historicalBrowseYear) => set({ historicalBrowseYear }),

  drivers: [],
  setDrivers: (drivers) => set({ drivers }),
  updateDriver: (driverNumber, patch) =>
    set((state) => ({
      drivers: state.drivers.map((d) =>
        d.driver_number === driverNumber ? { ...d, ...patch } : d
      ),
    })),

  weather: null,
  setWeather: (weather) => set({ weather }),

  raceControlMessages: [],
  addRaceControlMessage: (msg) =>
    set((state) => ({
      raceControlMessages: [...state.raceControlMessages.slice(-99), msg],
    })),

  alerts: [],
  addAlert: (alert) =>
    set((state) => ({
      alerts: [
        {
          ...alert,
          id: String(++alertIdCounter),
          read: false,
        },
        ...state.alerts.slice(0, 49),
      ],
    })),
  markAlertRead: (id) =>
    set((state) => ({
      alerts: state.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)),
    })),
  clearAlerts: () => set({ alerts: [] }),
  unreadCount: () => get().alerts.filter((a) => !a.read).length,

  selectedDriverNumber: null,
  setSelectedDriver: (selectedDriverNumber) => set({ selectedDriverNumber }),

  favoriteDriverNumber: null,
  setFavoriteDriver: (favoriteDriverNumber) => set({ favoriteDriverNumber }),

  isLiveTracking: true,
  setLiveTracking: (isLiveTracking) => set({ isLiveTracking }),
}));
