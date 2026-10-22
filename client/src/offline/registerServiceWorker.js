export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // Offline support is an enhancement; a registration failure must not
      // prevent the researcher portal itself from loading.
      console.error('Service worker registration failed', error);
    });
  });
}
