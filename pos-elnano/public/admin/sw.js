// Service worker mínimo: no cachea nada (el POS siempre necesita datos frescos),
// pero su sola presencia es lo que le indica a Android/Chrome que esta página
// es una app instalable de verdad, para que abra en pantalla completa sin bordes.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {}); // no intercepta nada, solo necesita existir
