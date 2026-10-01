---
title: Libro de cuentas
summary: Cuentas bancarias, registro de depositos/retiros y saldo corriente, como una hoja de calculo.
---
Runly Libro de cuentas es un registro bancario simple: llevas tus cuentas (bancos, efectivo, tarjetas) y capturas cada deposito o retiro, con el saldo corriente calculandose solo.

- **Cuentas**: cada cuenta bancaria o de efectivo que quieras controlar, con su saldo y su historial de movimientos.
- **Grupos**: agrupa cuentas relacionadas (por ejemplo, todas las de una sucursal) para consultarlas y darles seguimiento en conjunto.
- **Categorias** y **Tipos**: clasifican cada movimiento para que puedas ver en que se va o de donde viene el dinero.
- **Mis membresias**: a que cuentas tienes acceso y con que rol — quien solo puede consultar y quien puede capturar movimientos.

### Alcances y limites

- Puedes exportar e importar movimientos (por ejemplo desde un estado de cuenta), en vez de capturarlos uno por uno a mano.
- El acceso a una cuenta es por membresia: no todos los que usan el modulo ven todas las cuentas, solo aquellas a las que se les dio acceso.
- No reemplaza un sistema contable formal (polizas, impuestos, conciliacion fiscal) — es un registro operativo de entradas y salidas, pensado para saber cuanto dinero tienes y en que se ha ido, no para presentar declaraciones.
- Funciona sin conexion en la app de escritorio: puedes consultar cuentas, saldos e historial aunque no tengas internet; capturar movimientos nuevos si requiere estar conectado.

### Con MirAI

Con la pestaña de MirAI abierta puedes pedirle, por ejemplo:

- "Cuanto tenemos en BBVA"
- "Cuanto entro y salio de la cuenta este mes vs el anterior"
- "Registra un retiro de 500 pesos hoy en mi cuenta de efectivo"
- "Importa este estado de cuenta a la cuenta BBVA" (adjunta el PDF, imagen, CSV o XLSX en el chat)

MirAI reconoce los movimientos del estado de cuenta adjunto, te muestra cuantos encontro, el rango de fechas, los totales y cuantos posibles duplicados va a omitir, antes de pedirte confirmar la importacion. Si tienes una cuenta abierta, sabe cual es: puedes pedirle "cual es el saldo de esta cuenta" sin repetir el nombre. Como con cualquier accion, te muestra una tarjeta para confirmar antes de guardar algo.
