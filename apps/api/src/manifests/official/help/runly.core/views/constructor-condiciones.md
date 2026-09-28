---
viewKey: /module-builder/condiciones
title: Constructor - Condiciones de visibilidad
summary: Muestra una pestana, una seccion o un campo solo cuando otro campo tiene cierto valor, por ejemplo la seccion Fiscal solo si el Tipo es Empresa.
---
Las condiciones hacen que partes del formulario y del detalle aparezcan solo cuando aplican. Ejemplo: la seccion **Datos fiscales** se muestra solo si **Tipo = Empresa**; la pestana **Credito** solo si **Con credito = Si**.

### Como agregar una condicion

En el **Diseno** de la entidad:

- **Pestana o seccion**: boton con el icono de ojo ("Mostrar solo si...").
- **Campo**: menu (···) del campo, opcion **Mostrar solo si...**.

En el dialogo eliges:

1. **Campo** que controla la condicion. Solo se pueden usar campos de **Seleccion** o **Si/No**, y no puede ser un campo que esta dentro del mismo elemento que se oculta.
2. **Condicion**: *es igual a*, *no es igual a*, *es uno de*, *tiene valor* o *esta vacio* (para Si/No: *es Si* o *es No*).
3. **Valor** (o varios valores con *es uno de*).

Lo que tiene condicion muestra una etiqueta como "Visible si Tipo = Empresa". **Quitar condicion** la elimina.

### Como se comporta

- En el formulario, las partes aparecen y desaparecen al momento en que el usuario cambia el valor.
- En el detalle se evalua con los datos guardados del registro.
- Un campo **requerido** que esta oculto **no se exige**: solo es obligatorio mientras esta visible. El servidor aplica exactamente la misma regla, asi que no se puede saltar desde fuera de la pantalla.
- Ocultar un campo no borra su valor: si ya tenia un dato guardado, se conserva.
- Si la pestana que estabas viendo se oculta, el formulario pasa a la primera pestana visible.

### Probarlo

En la vista previa del **formulario** cambia el valor del campo de control y observa el efecto. En la del **detalle** usa la franja **Valores de prueba**.

### Limites

- Una sola condicion por elemento (no se combinan con "y" / "o").
- Si la entidad tiene una sola pestana, esa pestana no puede tener condicion.
