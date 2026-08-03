// Service worker mínimo — necessário para o navegador permitir instalar o app.
// Não faz cache agressivo para não esconder dados desatualizados de finanças.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
