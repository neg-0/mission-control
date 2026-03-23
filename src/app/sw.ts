/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import { Serwist } from 'serwist';

declare const self: ServiceWorkerGlobalScope;
declare const __SW_MANIFEST: (string | { url: string; revision: string | null })[];

const serwist = new Serwist({
  precacheEntries: __SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: defaultCache.filter(
    (entry) => !entry.matcher?.toString().includes('/api/')
  ),
});

serwist.addEventListeners();

self.addEventListener('push', (event: PushEvent) => {
  const data = event.data?.json() ?? {};
  const title = data.title ?? 'Mission Control';
  const options: NotificationOptions = {
    body: data.body ?? '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: data.url ? { url: data.url } : undefined,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(self.clients.openWindow(url));
});
