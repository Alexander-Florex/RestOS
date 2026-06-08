// ──────────────────────────────────────────────
// notifications.ts — Sonidos sintéticos + browser notifications
//
// Sin archivos de audio: genera tonos con Web Audio API.
// Persistencia del toggle en localStorage.
// ──────────────────────────────────────────────

const STORAGE_KEY = 'restos_notifications_enabled';

// ── Persistencia del toggle ──
export const notificationPrefs = {
  enabled(): boolean {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === 'true'; // default ON
  },
  setEnabled(v: boolean) {
    localStorage.setItem(STORAGE_KEY, String(v));
  },
};

// ── Web Audio API: tonos sintéticos ──
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  return audioContext;
}

interface Tone {
  frequency: number; // Hz
  duration: number;  // ms
  delay?: number;    // ms desde el inicio
}

/** Reproduce una secuencia de tonos cortos (envolvente AD). */
function playTones(tones: Tone[]) {
  const ctx = getAudioContext();
  if (!ctx) return;
  // En algunos navegadores, el contexto puede estar suspendido hasta la primera interacción
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const now = ctx.currentTime;
  for (const tone of tones) {
    const start = now + (tone.delay ?? 0) / 1000;
    const duration = tone.duration / 1000;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = tone.frequency;

    // Envolvente: attack rápido, decay corto
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.25, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration);
  }
}

/** Sonido para "pedido nuevo": dos tonos ascendentes (E5 → G5). */
export function playOrderSound() {
  if (!notificationPrefs.enabled()) return;
  playTones([
    { frequency: 659.25, duration: 120 },           // E5
    { frequency: 783.99, duration: 180, delay: 120 }, // G5
  ]);
}

/** Sonido para "cuenta pedida": dos tonos descendentes más altos para destacar (A5 → E5). */
export function playBillSound() {
  if (!notificationPrefs.enabled()) return;
  playTones([
    { frequency: 880.0,  duration: 150 },           // A5
    { frequency: 659.25, duration: 150, delay: 160 }, // E5
    { frequency: 880.0,  duration: 200, delay: 340 }, // A5
  ]);
}

/** Sonido suave para "reserva nueva": un solo tono. */
export function playReservationSound() {
  if (!notificationPrefs.enabled()) return;
  playTones([
    { frequency: 523.25, duration: 200 }, // C5
  ]);
}

// ── Browser Notification API ──
export const browserNotifications = {
  isSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  },

  permission(): NotificationPermission {
    return this.isSupported() ? Notification.permission : 'denied';
  },

  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return 'denied';
    if (Notification.permission === 'default') {
      return await Notification.requestPermission();
    }
    return Notification.permission;
  },

  /** Muestra una notificación si hay permiso y el toggle global está activo. */
  show(title: string, options?: NotificationOptions) {
    if (!notificationPrefs.enabled()) return;
    if (!this.isSupported() || Notification.permission !== 'granted') return;
    // Solo mostrar si la pestaña no está visible (no spamear si ya está mirando)
    if (document.visibilityState === 'visible') return;
    try {
      new Notification(title, {
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        ...options,
      });
    } catch {
      // Algunos navegadores fallan silenciosamente; no nos importa
    }
  },
};
