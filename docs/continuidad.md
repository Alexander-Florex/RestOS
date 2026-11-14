# Energía y continuidad (tarea 6.6)

Qué hacer para que un corte de luz o una PC rota no frenen el servicio, y qué hacer en papel si igual se cae todo.

## 1. UPS (batería) para la PC servidor y el router

Un corte de luz de segundos apaga la PC de golpe. MySQL/MariaDB aguanta bien, pero un corte en medio de un cobro puede dejar la base para revisar, y sin router los celulares no llegan al sistema.

**Qué comprar:** una UPS "interactiva" (line-interactive) de **800 a 1000 VA**. Alcanza para la PC servidor + el router + el módem de internet por 15 a 30 minutos. No hace falta que alimente la impresora.

**Cómo conectarla:**
- A la UPS (tomas con batería): la PC servidor, el monitor si se usa, el router WiFi y el módem.
- La impresora de comandas, a un toma común (consume mucho al arrancar y no hace falta en un corte corto).
- Si la UPS trae cable USB, conectarlo a la PC: Windows la ve como batería y en *Opciones de energía* se puede poner "apagar cuando quede 10 %" para que se apague bien si el corte es largo.

**Probarla** una vez: con el sistema andando, desenchufar la UPS de la pared. Todo tiene que seguir funcionando. Volver a enchufar.

**Cambiar la batería** cada 2 o 3 años (la UPS avisa con un pitido).

## 2. Si se corta internet

El sistema **sigue funcionando**: está en la PC del local. Los celulares tienen que estar en el **WiFi del local** (no con datos móviles) y entrar a `http://192.168.1.145/` (la IP de la PC en el local). Lo único que no anda sin internet: el respaldo a la nube (se reintenta solo cada hora) y entrar desde afuera.

## 3. Si se corta la luz más de lo que aguanta la UPS, o se rompe la PC

Plan en papel (dejar impreso, con talonarios a mano, junto a la caja):

1. **Comandas a mano**: el mozo anota mesa, platos y notas en el talonario; una copia va a cocina.
2. **Cobro a mano**: la caja suma la comanda, cobra y anota en una **planilla del día**: hora, mesa, total, medio de pago (efectivo / tarjeta / transferencia / a cuenta de quién).
3. **Cuentas corrientes** (Municipalidad, cooperativa): que firmen la comanda como siempre y guardarla aparte.
4. **Al volver el sistema**: cargar cada comanda de la planilla en la mesa que corresponda y cobrarla con el mismo medio de pago (así quedan en reportes y en la caja). Las de cuenta corriente, con "A cuenta".
5. Si la PC no vuelve: avisar al desarrollador. Los datos están en el respaldo de cada noche (carpeta `C:\RestOS\respaldos` y la copia en OneDrive). Ver `docs/restauracion.md`.

## 4. Si hay que reiniciar la PC

El sistema arranca solo con Windows (tarea "RestOS"), aunque nadie inicie sesión. Esperar 1 o 2 minutos después de prender y probar desde un celular.

## Lista para tener pegada junto a la caja

- [ ] Dirección del sistema en el local: `http://192.168.1.145/` (WiFi del local) o `http://10.147.17.83/` (ZeroTier)
- [ ] Talonario de comandas y planilla del día impresos
- [ ] Teléfono del desarrollador
- [ ] La contraseña de los respaldos **no** va acá: la guarda el dueño en un sobre
