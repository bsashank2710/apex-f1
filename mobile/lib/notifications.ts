/**
 * Push notification setup — permissions, token registration, local triggers.
 * Uses expo-notifications. All calls are safe to make on web (they no-op).
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// How notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const granted = await requestPermissions();
    if (!granted) return null;
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch {
    return null;
  }
}

type AlertType = 'flag' | 'safety_car' | 'pit' | 'fastest_lap' | 'general';

const ALERT_ICONS: Record<AlertType, string> = {
  flag: '🚩',
  safety_car: '🚗',
  pit: '🔧',
  fastest_lap: '⚡',
  general: '📣',
};

export async function sendLocalNotification(
  type: AlertType,
  title: string,
  body: string,
): Promise<void> {
  if (Platform.OS === 'web') return;
  const granted = await requestPermissions();
  if (!granted) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${ALERT_ICONS[type]} ${title}`,
      body,
      sound: true,
      data: { type },
    },
    trigger: null, // Fire immediately
  });
}

/**
 * Analyse an OpenF1 race control message and fire a local notification
 * for high-priority events (safety cars, red flags, DRS opens).
 */
export async function notifyRaceControlMessage(msg: {
  flag?: string;
  category?: string;
  message?: string;
  lap_number?: number;
}): Promise<void> {
  const { flag, category, message, lap_number } = msg;
  const lap = lap_number ? ` (Lap ${lap_number})` : '';

  if (flag === 'RED') {
    await sendLocalNotification('flag', `🔴 RED FLAG${lap}`, message ?? 'Red flag shown');
  } else if (category === 'SafetyCar') {
    const isSC = message?.includes('SAFETY CAR');
    const isVSC = message?.includes('VIRTUAL');
    const type: AlertType = 'safety_car';
    const title = isVSC ? `VSC DEPLOYED${lap}` : isSC ? `SAFETY CAR${lap}` : `Safety Car${lap}`;
    await sendLocalNotification(type, title, message ?? '');
  } else if (flag === 'YELLOW') {
    await sendLocalNotification('flag', `🟡 YELLOW FLAG${lap}`, message ?? 'Yellow flag');
  } else if (flag === 'CHEQUERED') {
    await sendLocalNotification('flag', '🏁 CHEQUERED FLAG', message ?? 'Race finished!');
  } else if (category === 'Drs' && message?.includes('ENABLED')) {
    await sendLocalNotification('general', 'DRS ENABLED', message ?? '');
  }
}

export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void,
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(handler);
}

export function removeSubscription(sub: Notifications.Subscription): void {
  sub.remove();
}
