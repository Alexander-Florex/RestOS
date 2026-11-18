# Acceso remoto y HTTPS (tareas 6.2 y 6.4)

## Situación actual

- El local ya usa **ZeroTier**: los celulares con la app de ZeroTier entran a `http://10.147.17.83/` desde cualquier lado. Eso **ya resuelve el acceso del dueño desde afuera**: instala ZeroTier en su celular, se une a la misma red y lo autorizás en `my.zerotier.com`.
- El tráfico de ZeroTier va cifrado de punta a punta, aunque la dirección diga `http://`.
- El sistema pide usuario y contraseña, bloquea tras varios intentos fallidos y corta la sesión a las 12 h.

## Qué falta y por qué

Las **notificaciones del navegador** (aviso de "pidieron la cuenta" con la pantalla apagada) y algunas funciones de celular exigen **HTTPS**. Con `http://` el sistema funciona igual, pero los avisos solo suenan con la app abierta.

## Recomendación

**Tailscale** en vez de ZeroTier para el acceso del dueño y HTTPS:

1. Instalar Tailscale en la PC del local y en los celulares que necesiten entrar de afuera (gratis hasta 100 dispositivos).
2. En la PC del local, una sola vez (PowerShell como administrador):
   ```powershell
   tailscale serve --bg 80
   ```
   Eso publica el sistema en `https://<nombre-de-la-pc>.<tu-red>.ts.net` con certificado válido (lo renueva Tailscale), **solo para los dispositivos de tu red**, no para internet.
3. Con esa dirección HTTPS funcionan las notificaciones.

En el local, los mozos pueden seguir entrando por el WiFi a `http://192.168.1.145/` (más rápido); la dirección HTTPS es para el dueño y para quien quiera notificaciones.

**No recomendado:** abrir un puerto del router a internet (expone el sistema a cualquiera) ni certificados "caseros" (mkcert), porque hay que instalarlos a mano en cada celular.

## Decisión pendiente

- ¿Pasamos el acceso remoto a Tailscale (con HTTPS) o seguimos con ZeroTier y sin notificaciones con la pantalla apagada? Se puede tener los dos a la vez mientras se prueba.
