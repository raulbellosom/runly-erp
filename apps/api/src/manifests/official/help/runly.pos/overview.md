---
title: POS
summary: Punto de venta para restaurante, tienda u operaciones mixtas.
---
Runly POS es la terminal de venta: cobra, maneja mesas y comandas, envia pedidos a cocina y cierra caja al final del turno. Sirve tanto para un restaurante con mesas como para una tienda o mostrador que solo necesita cobrar.

- **Caja**: donde se cobra al cliente — agregar productos, aplicar descuentos, elegir forma de pago y cerrar la venta.
- **Comandero**: para tomar pedidos por mesa antes de cobrar (restaurantes); el pedido se envia solo a Cocina.
- **Cocina**: pantalla en tiempo real donde el personal de cocina ve los pedidos entrantes y los marca conforme los va preparando.
- **Ordenes**: historial de ordenes ya tomadas o cerradas, para consulta y reconciliacion.
- **Administracion**: distribucion de mesas (plano del local), impresoras de cocina/recibo y demas ajustes operativos del punto de venta.

### Como se conecta con el resto del sistema

- Los productos que se venden aqui vienen del modulo de Catalogo — das de alta un producto una sola vez y esta disponible tanto en POS como en Inventario.
- El cliente de una venta puede vincularse a un contacto existente del modulo de Contactos, si quieres llevar ese historial.

### Alcances y limites

- El cierre de caja resume las ventas y pagos del turno; una vez cerrado, ese turno queda fijo para reportes.
- Comandero y Cocina son opcionales si tu operacion es de mostrador puro (tienda): puedes cobrar directo en Caja sin pasar por mesas.
