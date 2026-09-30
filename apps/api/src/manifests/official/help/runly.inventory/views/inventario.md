---
viewKey: /inventory
title: Inventario
summary: Lista completa de activos de la empresa, con su estado y ubicacion.
---
Aqui ves todos los activos registrados: nombre, etiqueta, numero de serie, estado y a quien esta asignado.

- Busca y filtra por tipo, estado o responsable asignado para encontrar un activo especifico. Tambien puedes filtrar por rango de fechas de alta o de compra.
- Haz clic en el encabezado de una columna para ordenar ascendente, descendente o quitar el orden.
- Con "Importar" cargas un Excel o CSV sin usar IA: relacionas cada columna del archivo con un campo (nombre, serie, tipo, marca, ubicacion, fechas, precio...), revisas la vista previa y se crean los activos. Las etiquetas o series que ya existen se omiten, y puedes crear en el momento los tipos, marcas, modelos o ubicaciones que falten; quedan relacionados con los activos importados. Tambien puedes relacionar columnas con tus campos personalizados. Si tu archivo usa otras palabras para la disponibilidad (por ejemplo "Operando"), la vista previa te pide a que estado corresponde cada una. Una columna "Estado" acepta Alta o Pendiente de alta, y una "Disponibilidad" acepta Disponible o Mantenimiento, y una columna "Condicion" se relaciona con tu catalogo de condiciones; las bajas no se importan, se proponen desde la ficha del activo.
- Fotos en la importacion: en Excel inserta la imagen sobre la fila del activo (Insertar > Imagenes), o agrega una columna con enlaces directos a imagenes (separados por coma, hasta 5 por activo). Las imagenes "colocadas en la celda" de Excel 365 no se leen; usa "colocar sobre las celdas".
- El nombre es opcional: si lo dejas vacio se genera con la marca y el modelo (por ejemplo "Dell XPS 15"), o con el tipo. Si despues borras el nombre al editar, se vuelve a generar.
- Al registrar o editar un activo, elige su modelo: el tipo y la marca se completan solos. Puedes buscar el modelo por cualquier dato (nombre, marca, tipo o año), por ejemplo "dell 2023 xps".
- Si el modelo no existe, escribelo y elige "Crear": se abre la ventana de nuevo modelo, donde tambien puedes crear el tipo y la marca. Lo que crees aparece de inmediato en el formulario y en Catalogos.
- Para capturar muchos equipos iguales: en Nuevo activo usa "Campos fijados" para conservar modelo, ubicacion o datos de compra entre un guardado y otro (se recuerdan en este navegador), y activa "Captura continua" para empezar otro al guardar.
- Con "Varios por serie" pegas los numeros de serie separados por coma, espacio o salto de linea y se crea un activo por serie (hasta 200), nombrado "Nombre · serie". Las series que ya existen se señalan antes de guardar.
- El detalle de un activo muestra su historial completo: cuando se dio de alta, sus asignaciones anteriores y cambios de estado.
- Cada activo tiene un Estado (Pendiente de alta, Alta, Propuesta de baja o Baja) y, aparte, una Disponibilidad (Disponible, Asignado o Mantenimiento). La lista muestra por defecto los activos en Alta y con Propuesta de baja; usa el filtro "Estado" o los indicadores de arriba para ver los demas.
- Para dar de baja un activo, abre su ficha y usa "Proponer baja" con el motivo (obsolescencia, daño, perdida, robo, venta, donacion, destruccion u otro). Quien tiene el permiso "Autorizar bajas de activos" la autoriza o la rechaza; al autorizarla, si estaba asignado se registra su devolucion y el activo queda de solo lectura. Una baja se puede revertir con un comentario.
- Un activo "Pendiente de alta" no se puede asignar hasta que alguien con el permiso "Confirmar altas de activos" confirme su alta.
- Cada movimiento queda en el historial administrativo del activo con fecha, motivo, comentario, evidencia y quien lo hizo.
- Selecciona varios activos en el mismo estado para confirmar altas, proponer, autorizar o rechazar bajas en lote.
- La condicion fisica (Nuevo, En uso, Descompuesto...) es descriptiva y se elige en el formulario; administra la lista en Catalogos > Condiciones.
- En la ficha de un activo, "Compras relacionadas" muestra su historia de compra (expediente, solicitud, orden, recepcion, factura y pago) con el monto asignado. Desde ahi creas una orden o factura para ese activo, relacionas un documento existente de Compras o quitas una relacion.
- "Origen de adquisicion" indica como llego el activo: Compra, Donacion, Transferencia, Arrendamiento, Produccion interna, Inventario inicial u Otro. Los datos de compra capturados antes de Compras se muestran como "Datos de compra heredados" y solo se pueden corregir en activos que ya los tienen.
