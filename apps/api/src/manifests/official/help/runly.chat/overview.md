---
title: Chat
summary: Mensajeria interna en tiempo real (chats, grupos y canales), llamadas, y bandeja de soporte para visitantes externos del sitio web.
---
Runly Chat es la mensajeria interna de la empresa: conversaciones uno a uno, grupos y canales, con llamadas de voz/video y transcripcion opcional.

Tambien incluye:

- **MirAI**: el asistente de IA integrado al chat. Puede responder preguntas generales, buscar informacion dentro de tus propias conversaciones y (si esta configurado) consultar datos en vivo de internet. Requiere que la instancia tenga un motor de IA configurado; si no, la conversacion con MirAI sigue apareciendo en tu lista pero el cuadro de escritura muestra "no configurado".
- **Bandeja externa**: mensajes que llegan de visitantes del sitio web publico, gestionados por el equipo de soporte.
- **Plantillas**: respuestas rapidas predefinidas para agilizar la atencion.

### Alcances y limites

- Grabar una llamada y pedir su transcripcion requiere permisos especificos (`chat.calls.record`, `chat.calls.transcript.request`/`manage`).
- Analizar una transcripcion con MirAI requiere el permiso `chat.calls.transcript.analyze` y que la instancia tenga IA configurada.
- La bandeja externa es solo para el equipo de soporte (`chat.support.manage`), no para todos los usuarios.
