// Curated icon library shared by IconLibraryPanel callers (canvas hotspots,
// note icons): lucide icon names (kebab-case, as stored) grouped by use, with
// Spanish labels and search keywords. Any other lucide icon is still
// selectable from "Todos los iconos" (see registry.js).
const C = (label, icon, items) => ({ label, icon, items: items.map(([name, es, keywords = '']) => ({ name, label: es, keywords })) })

export const ICON_CATEGORIES = [
  C('Ideas, trabajo y estudio', 'lightbulb', [
    ['notebook-pen', 'Cuaderno', 'nota apuntes libreta'], ['book-open', 'Libro', 'lectura documentacion'], ['file-text', 'Documento', 'archivo texto'],
    ['lightbulb', 'Idea', 'foco ocurrencia'], ['brain', 'Pensamiento', 'mente cerebro'], ['sparkles', 'Destacado', 'magia brillo'],
    ['star', 'Favorito', 'estrella importante'], ['heart', 'Personal', 'corazon me gusta'], ['bookmark', 'Marcador', 'guardar leer despues'],
    ['pen', 'Escritura', 'pluma redaccion'], ['clipboard-list', 'Lista', 'checklist pendientes'], ['list-todo', 'Tareas', 'pendientes por hacer'],
    ['square-check', 'Hecho', 'completado tarea'], ['briefcase', 'Trabajo', 'maletin oficina'], ['target', 'Objetivo', 'meta diana'],
    ['rocket', 'Lanzamiento', 'proyecto inicio'], ['trophy', 'Logro', 'premio meta'], ['flag', 'Hito', 'bandera'],
    ['flame', 'Urgente', 'fuego prioridad'], ['zap', 'Rapido', 'energia rayo'], ['calendar', 'Agenda', 'calendario fecha'],
    ['clock', 'Tiempo', 'hora reloj'], ['bell', 'Recordatorio', 'aviso campana'], ['mail', 'Correo', 'email mensaje'],
    ['message-square', 'Conversacion', 'chat mensaje'], ['users', 'Reunion', 'equipo personas'], ['graduation-cap', 'Estudio', 'curso escuela aprendizaje'],
    ['code-xml', 'Codigo', 'programacion desarrollo'], ['terminal', 'Terminal', 'consola comandos'], ['database', 'Base de datos', 'datos'],
    ['git-branch', 'Version', 'rama git'], ['chart-column', 'Reporte', 'grafica estadistica'], ['trending-up', 'Crecimiento', 'tendencia ventas'],
    ['dollar-sign', 'Dinero', 'finanzas pago'], ['plane', 'Viaje', 'avion vacaciones'], ['coffee', 'Pausa', 'cafe descanso'],
    ['music', 'Musica', 'cancion'], ['film', 'Video', 'pelicula'], ['palette', 'Diseno', 'colores arte'],
    ['leaf', 'Naturaleza', 'hoja ecologia'], ['moon', 'Noche', 'luna'], ['gift', 'Regalo', 'cumpleanos'],
  ]),
  C('Seguridad y emergencias', 'shield-alert', [
    ['fire-extinguisher', 'Extintor', 'incendio fuego'], ['flame', 'Fuego', 'incendio llama calor'], ['siren', 'Alarma', 'sirena emergencia'],
    ['bell-ring', 'Timbre de alarma', 'alerta campana'], ['shield-alert', 'Riesgo', 'peligro seguridad'], ['shield-check', 'Zona segura', 'seguridad protegido'],
    ['triangle-alert', 'Advertencia', 'peligro precaucion'], ['octagon-alert', 'Alto', 'stop detener'], ['cctv', 'Camara de seguridad', 'vigilancia cctv video'],
    ['door-open', 'Salida', 'puerta emergencia evacuacion'], ['door-closed', 'Puerta', 'acceso'], ['lock', 'Cerrado', 'candado seguridad acceso'],
    ['key-round', 'Llave', 'acceso llaves'], ['hard-hat', 'Casco', 'epp proteccion obra'], ['heart-pulse', 'Primeros auxilios', 'botiquin salud desfibrilador'],
    ['cross', 'Enfermeria', 'medico cruz salud'], ['life-buoy', 'Salvavidas', 'rescate'], ['radiation', 'Radiacion', 'peligro'],
    ['biohazard', 'Riesgo biologico', 'peligro'], ['skull', 'Peligro', 'toxico veneno'], ['footprints', 'Ruta de evacuacion', 'pasos camino'],
    ['scan-face', 'Control de acceso', 'reconocimiento facial'], ['fingerprint', 'Huella', 'biometrico acceso'], ['badge-alert', 'Incidente', 'alerta'],
  ]),
  C('Electricidad y energia', 'zap', [
    ['zap', 'Electricidad', 'energia rayo corriente'], ['plug', 'Contacto', 'enchufe toma'], ['plug-zap', 'Toma electrica', 'enchufe corriente'],
    ['power', 'Interruptor', 'encendido apagado'], ['toggle-right', 'Apagador', 'switch interruptor'], ['cable', 'Cable', 'cableado'],
    ['battery-charging', 'Bateria', 'carga ups'], ['battery-full', 'UPS', 'bateria respaldo'], ['lightbulb', 'Lampara', 'luz foco iluminacion'],
    ['lamp-ceiling', 'Luminaria', 'luz techo iluminacion'], ['lamp', 'Lampara de mesa', 'luz'], ['sun', 'Solar', 'panel sol luz'],
    ['solar-panel', 'Panel solar', 'energia solar fotovoltaico'], ['gauge', 'Medidor', 'contador manometro'], ['activity', 'Monitoreo', 'senal actividad'],
    ['circuit-board', 'Tablero', 'circuito placa control'], ['fuel', 'Combustible', 'gasolina diesel planta'], ['plug-2', 'Clavija', 'enchufe'], ['bell-electric', 'Timbre', 'campana electrica'],
  ]),
  C('Agua, gas y climatizacion', 'droplet', [
    ['droplet', 'Agua', 'gota fuga'], ['droplets', 'Humedad', 'goteo fuga'], ['waves', 'Inundacion', 'agua nivel'],
    ['shower-head', 'Regadera', 'bano ducha'], ['bath', 'Bano', 'tina sanitario'], ['toilet', 'Sanitario', 'bano wc inodoro'],
    ['heater', 'Calentador', 'boiler agua caliente'], ['thermometer', 'Temperatura', 'termometro calor frio'], ['snowflake', 'Refrigeracion', 'frio aire acondicionado'],
    ['fan', 'Ventilador', 'extractor aire'], ['air-vent', 'Ventilacion', 'aire acondicionado rejilla'], ['wind', 'Aire', 'viento ventilacion'],
    ['cloud-rain', 'Lluvia', 'pluvial drenaje'], ['flame-kindling', 'Gas', 'estufa calentador'], ['container', 'Tanque', 'cisterna deposito'],
    ['milk', 'Garrafon', 'agua purificada'], ['glass-water', 'Bebedero', 'agua potable'], ['spray-can', 'Limpieza', 'aerosol quimico'],
  ]),
  C('Redes y tecnologia', 'wifi', [
    ['wifi', 'Wifi', 'internet red inalambrico'], ['router', 'Router', 'red internet modem'], ['server', 'Servidor', 'site rack datos'],
    ['network', 'Red', 'switch conexion'], ['ethernet-port', 'Nodo de red', 'puerto ethernet cable datos'], ['hard-drive', 'Almacenamiento', 'disco nas'],
    ['monitor', 'Monitor', 'pantalla computadora'], ['laptop', 'Laptop', 'computadora portatil'], ['printer', 'Impresora', 'impresion'],
    ['phone', 'Telefono', 'extension llamada'], ['smartphone', 'Celular', 'movil'], ['tv', 'Television', 'pantalla'],
    ['projector', 'Proyector', 'sala juntas'], ['webcam', 'Camara web', 'video'], ['radio', 'Radio', 'antena comunicacion'],
    ['satellite-dish', 'Antena', 'satelital parabolica'], ['cpu', 'Equipo', 'procesador hardware'], ['qr-code', 'Codigo QR', 'escaneo etiqueta'],
    ['scan-barcode', 'Lector', 'codigo de barras escaner'], ['bluetooth', 'Bluetooth', 'inalambrico'], ['speaker', 'Bocina', 'audio sonido'],
  ]),
  C('Oficina y mobiliario', 'armchair', [
    ['armchair', 'Sillon', 'mueble silla'], ['sofa', 'Sala', 'sofa mueble'], ['bed', 'Cama', 'dormitorio habitacion'],
    ['lamp-desk', 'Escritorio', 'mesa trabajo'], ['presentation', 'Sala de juntas', 'presentacion reunion'], ['book-open', 'Biblioteca', 'libros archivo'],
    ['archive', 'Archivo', 'archivero documentos'], ['inbox', 'Recepcion', 'buzon entrada'], ['clipboard', 'Registro', 'checklist'],
    ['file-text', 'Documento', 'archivo papel'], ['folder', 'Carpeta', 'archivo'], ['coffee', 'Cafeteria', 'cafe comedor'],
    ['utensils', 'Comedor', 'cocina comida'], ['refrigerator', 'Refrigerador', 'cocina'], ['microwave', 'Microondas', 'cocina'],
    ['trash-2', 'Basura', 'bote residuos'], ['recycle', 'Reciclaje', 'residuos'], ['shirt', 'Vestidor', 'ropa uniforme'],
    ['clock', 'Reloj', 'checador hora'], ['calendar', 'Agenda', 'calendario'], ['mail', 'Correo', 'buzon paqueteria'],
  ]),
  C('Almacen y logistica', 'warehouse', [
    ['package', 'Paquete', 'caja producto'], ['boxes', 'Inventario', 'cajas almacen stock'], ['warehouse', 'Almacen', 'bodega'],
    ['carton', 'Caja de carton', 'empaque'], ['forklift', 'Montacargas', 'carga'], ['truck', 'Camion', 'reparto transporte'],
    ['container', 'Contenedor', 'deposito'], ['shelving-unit', 'Estanteria', 'rack anaquel'], ['layers', 'Niveles', 'pisos capas'],
    ['scale', 'Bascula', 'peso balanza'], ['tag', 'Etiqueta', 'precio sku'], ['barcode', 'Codigo de barras', 'sku producto'],
    ['shopping-cart', 'Carrito', 'compras'], ['package-check', 'Recibido', 'entregado paquete'], ['package-x', 'Faltante', 'paquete error'],
    ['truck-electric', 'Vehiculo electrico de carga', 'reparto'], ['map-pin', 'Ubicacion', 'punto lugar'], ['navigation', 'Ruta', 'direccion'],
  ]),
  C('Herramientas y mantenimiento', 'wrench', [
    ['wrench', 'Mantenimiento', 'herramienta llave reparacion'], ['hammer', 'Martillo', 'herramienta reparacion'], ['drill', 'Taladro', 'herramienta'],
    ['tool-case', 'Estuche de herramientas', 'kit'], ['ruler', 'Medida', 'regla metro'], ['paint-roller', 'Pintura', 'rodillo'],
    ['paintbrush', 'Brocha', 'pintura'], ['construction', 'Obra', 'construccion trabajos'], ['traffic-cone', 'Cono', 'precaucion obra'],
    ['cog', 'Maquinaria', 'engrane mecanismo'], ['settings', 'Configuracion', 'ajustes engrane'], ['factory', 'Planta', 'fabrica industria'],
    ['pickaxe', 'Excavacion', 'pico'], ['shovel', 'Pala', 'jardineria'], ['brush-cleaning', 'Aseo', 'limpieza escoba'],
    ['waves-ladder', 'Alberca', 'piscina escalera'], ['toolbox', 'Caja de herramientas', 'herramientas'], ['pipette', 'Muestra', 'laboratorio'],
  ]),
  C('Vehiculos y transporte', 'car', [
    ['car', 'Auto', 'vehiculo carro'], ['car-front', 'Estacionamiento', 'vehiculo cajon'], ['bus', 'Autobus', 'transporte'],
    ['truck', 'Camion', 'carga'], ['bike', 'Bicicleta', 'ciclista'], ['motorbike', 'Motocicleta', 'moto'],
    ['circle-parking', 'Parking', 'estacionamiento'], ['fuel', 'Gasolinera', 'combustible'], ['ev-charger', 'Cargador electrico', 'vehiculo electrico'],
    ['plane', 'Avion', 'aeropuerto'], ['ship', 'Barco', 'puerto'], ['train-front', 'Tren', 'estacion'],
    ['tractor', 'Tractor', 'campo agricola'], ['caravan', 'Remolque', 'caravana'], ['ship-wheel', 'Timon', 'nautico'],
  ]),
  C('Personas', 'users', [
    ['user', 'Persona', 'usuario empleado'], ['users', 'Equipo', 'personas grupo'], ['user-round-check', 'Responsable', 'encargado asignado'],
    ['contact', 'Contacto', 'directorio'], ['baby', 'Lactario', 'bebe'], ['accessibility', 'Accesibilidad', 'discapacidad rampa'],
    ['person-standing', 'Personal', 'trabajador'], ['hand-helping', 'Atencion', 'ayuda servicio'], ['graduation-cap', 'Capacitacion', 'escuela aula'],
    ['stethoscope', 'Medico', 'consultorio salud'], ['dumbbell', 'Gimnasio', 'ejercicio'], ['smile', 'Cliente', 'satisfaccion'],
  ]),
  C('Lugares y edificios', 'building-2', [
    ['building', 'Edificio', 'oficinas'], ['building-2', 'Corporativo', 'edificio'], ['house', 'Casa', 'hogar'],
    ['store', 'Tienda', 'local sucursal'], ['school', 'Escuela', 'aula'], ['hospital', 'Hospital', 'clinica'],
    ['hotel', 'Hotel', 'hospedaje'], ['landmark', 'Gobierno', 'banco institucion'], ['church', 'Iglesia', 'templo'],
    ['tent', 'Carpa', 'evento campamento'], ['fence', 'Barda', 'reja cerca'], ['trees', 'Area verde', 'jardin arboles'],
    ['flower-2', 'Jardin', 'flores'], ['mountain', 'Terreno', 'montana'], ['map', 'Mapa', 'plano zona'],
    ['compass', 'Orientacion', 'brujula norte'], ['flag', 'Punto de reunion', 'bandera marca'], ['door-stairwell', 'Escaleras', 'escalera piso cubo'],
    ['arrow-up-down', 'Elevador', 'ascensor'], ['grid-3x3', 'Area', 'zona cuadricula'], ['square-dashed', 'Zona', 'area delimitada'],
  ]),
  C('Estados y senales', 'circle-check', [
    ['circle-check', 'Listo', 'correcto ok completado'], ['circle-x', 'Falla', 'error'], ['circle-alert', 'Atencion', 'alerta'],
    ['circle-help', 'Duda', 'pregunta'], ['info', 'Informacion', 'info'], ['circle-pause', 'En pausa', 'detenido'],
    ['circle-dot', 'Punto', 'marca'], ['star', 'Importante', 'favorito destacado'], ['bookmark', 'Marcador', 'guardar'],
    ['eye', 'Revisar', 'inspeccion ver'], ['search', 'Inspeccion', 'buscar revisar'], ['message-circle', 'Comentario', 'nota observacion'],
    ['sticky-note', 'Nota', 'post-it'], ['camera', 'Foto', 'evidencia fotografia'], ['image', 'Imagen', 'foto'],
    ['clipboard-check', 'Inspeccionado', 'checklist verificado'], ['hourglass', 'Pendiente', 'espera tiempo'], ['ban', 'Prohibido', 'no permitido'],
    ['thumbs-up', 'Aprobado', 'ok'], ['thumbs-down', 'Rechazado', 'mal'], ['hash', 'Numero', 'identificador'],
  ]),
  C('Finanzas y comercio', 'wallet', [
    ['wallet', 'Cartera', 'billetera dinero'], ['banknote', 'Efectivo', 'billete dinero'], ['coins', 'Monedas', 'cambio dinero'],
    ['piggy-bank', 'Ahorro', 'alcancia'], ['credit-card', 'Tarjeta', 'pago credito debito'], ['receipt', 'Recibo', 'ticket comprobante'],
    ['receipt-text', 'Factura', 'comprobante cfdi'], ['landmark', 'Banco', 'institucion financiera'], ['hand-coins', 'Pago', 'cobro propina'],
    ['badge-dollar-sign', 'Precio', 'costo tarifa'], ['badge-percent', 'Descuento', 'promocion oferta'], ['percent', 'Porcentaje', 'impuesto iva'],
    ['calculator', 'Calculadora', 'cuentas contabilidad'], ['chart-line', 'Tendencia', 'grafica linea'], ['chart-pie', 'Distribucion', 'grafica pastel'],
    ['chart-no-axes-column-increasing', 'Indicadores', 'kpi metricas'], ['trending-down', 'Baja', 'perdida caida'], ['scale', 'Balance', 'equilibrio legal'],
    ['shopping-bag', 'Bolsa de compra', 'tienda venta'], ['shopping-basket', 'Canasta', 'super compras'], ['store', 'Tienda', 'local comercio'],
    ['handshake', 'Acuerdo', 'trato negocio cliente'], ['gem', 'Premium', 'valor joya'], ['ticket', 'Boleto', 'entrada evento cupon'],
  ]),
  C('Comunicacion', 'message-circle', [
    ['message-circle', 'Mensaje', 'chat conversacion'], ['messages-square', 'Conversaciones', 'chat grupo'], ['mail-open', 'Correo leido', 'email'],
    ['send', 'Enviar', 'mandar envio'], ['inbox', 'Bandeja', 'entrada correo'], ['phone-call', 'Llamada', 'telefono'],
    ['video', 'Videollamada', 'reunion camara'], ['mic', 'Microfono', 'audio voz grabar'], ['megaphone', 'Anuncio', 'aviso campana marketing'],
    ['at-sign', 'Arroba', 'mencion correo'], ['share-2', 'Compartir', 'red social'], ['link', 'Enlace', 'url vinculo'],
    ['rss', 'Noticias', 'feed suscripcion'], ['newspaper', 'Periodico', 'noticias boletin'], ['languages', 'Idiomas', 'traduccion'],
    ['bell-dot', 'Notificacion', 'aviso alerta'], ['quote', 'Cita', 'frase testimonio'], ['voicemail', 'Buzon de voz', 'mensaje'],
  ]),
  C('Documentos y archivos', 'file-text', [
    ['file', 'Archivo', 'documento'], ['file-check', 'Aprobado', 'documento validado'], ['file-signature', 'Contrato', 'firma documento'],
    ['file-spreadsheet', 'Hoja de calculo', 'excel tabla'], ['file-image', 'Imagen', 'foto archivo'], ['file-video', 'Video', 'archivo'],
    ['file-audio', 'Audio', 'archivo sonido'], ['file-code', 'Codigo', 'archivo programacion'], ['file-lock', 'Confidencial', 'privado protegido'],
    ['files', 'Archivos', 'documentos varios'], ['folder-open', 'Carpeta abierta', 'directorio'], ['folder-kanban', 'Proyecto', 'carpeta tablero'],
    ['notebook', 'Libreta', 'cuaderno apuntes'], ['notebook-tabs', 'Agenda', 'cuaderno secciones'], ['book', 'Manual', 'libro guia'],
    ['library', 'Biblioteca', 'libros coleccion'], ['scroll-text', 'Politica', 'reglamento acta'], ['signature', 'Firma', 'autorizar'],
    ['stamp', 'Sello', 'oficial tramite'], ['printer', 'Imprimir', 'impresion'], ['paperclip', 'Adjunto', 'clip anexo'],
  ]),
  C('Tiempo y planeacion', 'calendar-days', [
    ['calendar-days', 'Calendario', 'mes dias'], ['calendar-check', 'Evento confirmado', 'cita agenda'], ['calendar-clock', 'Programado', 'cita hora'],
    ['calendar-range', 'Periodo', 'rango fechas'], ['alarm-clock', 'Alarma', 'despertador recordatorio'], ['timer', 'Temporizador', 'cronometro'],
    ['hourglass', 'Espera', 'reloj arena pendiente'], ['history', 'Historial', 'pasado registro'], ['repeat', 'Recurrente', 'repetir ciclo'],
    ['kanban', 'Tablero', 'kanban columnas'], ['list-checks', 'Checklist', 'lista verificacion'], ['list-ordered', 'Pasos', 'lista numerada procedimiento'],
    ['milestone', 'Hito', 'meta etapa'], ['goal', 'Meta', 'objetivo bandera'], ['route', 'Ruta', 'camino plan'],
    ['gantt-chart', 'Cronograma', 'gantt planeacion'], ['workflow', 'Flujo', 'proceso automatizacion'], ['git-merge', 'Integracion', 'unir'],
  ]),
  C('Salud y bienestar', 'heart-pulse', [
    ['heart-pulse', 'Salud', 'pulso medico'], ['pill', 'Medicamento', 'pastilla farmacia'], ['syringe', 'Vacuna', 'inyeccion'],
    ['thermometer', 'Fiebre', 'temperatura'], ['activity', 'Signos vitales', 'monitoreo'], ['brain', 'Salud mental', 'mente'],
    ['bone', 'Hueso', 'ortopedia'], ['ear', 'Oido', 'audicion'], ['eye', 'Vision', 'ojo'],
    ['hand-heart', 'Cuidado', 'apoyo voluntariado'], ['apple', 'Nutricion', 'manzana dieta'], ['bed-double', 'Descanso', 'dormir'],
    ['dumbbell', 'Ejercicio', 'gimnasio pesas'], ['footprints', 'Caminata', 'pasos'], ['smile', 'Bienestar', 'feliz'],
    ['ambulance', 'Ambulancia', 'emergencia'], ['hospital', 'Clinica', 'hospital'], ['microscope', 'Laboratorio', 'analisis'],
  ]),
  C('Comida y bebida', 'utensils-crossed', [
    ['utensils-crossed', 'Restaurante', 'comida cubiertos'], ['chef-hat', 'Cocina', 'chef'], ['cooking-pot', 'Guiso', 'olla cocinar'],
    ['pizza', 'Pizza', 'comida rapida'], ['sandwich', 'Sandwich', 'torta lunch'], ['salad', 'Ensalada', 'saludable'],
    ['soup', 'Sopa', 'caldo'], ['beef', 'Carne', 'res'], ['fish', 'Pescado', 'mariscos'],
    ['croissant', 'Panaderia', 'pan'], ['cake', 'Pastel', 'postre cumpleanos'], ['ice-cream-cone', 'Helado', 'postre'],
    ['cookie', 'Galleta', 'snack'], ['egg', 'Huevo', 'desayuno'], ['carrot', 'Verdura', 'vegetal'],
    ['coffee', 'Cafe', 'bebida caliente'], ['cup-soda', 'Refresco', 'bebida'], ['wine', 'Vino', 'bebida alcohol'],
    ['beer', 'Cerveza', 'bebida bar'], ['martini', 'Coctel', 'bar bebida'], ['glass-water', 'Agua', 'vaso'],
  ]),
  C('Educacion y ciencia', 'graduation-cap', [
    ['graduation-cap', 'Graduacion', 'titulo universidad'], ['school', 'Escuela', 'colegio'], ['book-open-check', 'Leccion', 'aprendido'],
    ['library-big', 'Acervo', 'biblioteca'], ['pencil', 'Lapiz', 'escribir'], ['pencil-ruler', 'Diseno tecnico', 'dibujo'],
    ['notebook-pen', 'Apuntes', 'clase'], ['presentation', 'Clase', 'exposicion pizarron'], ['award', 'Reconocimiento', 'medalla diploma'],
    ['medal', 'Medalla', 'premio'], ['flask-conical', 'Quimica', 'laboratorio experimento'], ['atom', 'Fisica', 'ciencia atomo'],
    ['dna', 'Biologia', 'genetica'], ['telescope', 'Astronomia', 'investigacion'], ['sigma', 'Matematicas', 'formula suma'],
    ['globe', 'Geografia', 'mundo'], ['puzzle', 'Reto', 'rompecabezas'], ['brain-circuit', 'Inteligencia artificial', 'ia'],
  ]),
  C('Deportes y ocio', 'trophy', [
    ['trophy', 'Campeonato', 'copa'], ['volleyball', 'Voleibol', 'pelota'], ['goal', 'Futbol', 'porteria gol'],
    ['bike', 'Ciclismo', 'bicicleta'], ['dumbbell', 'Gimnasio', 'pesas'], ['gamepad-2', 'Videojuegos', 'control juego'],
    ['dice-5', 'Juegos', 'dado azar'], ['drama', 'Teatro', 'mascaras'], ['clapperboard', 'Cine', 'pelicula'],
    ['headphones', 'Audio', 'audifonos musica'], ['guitar', 'Guitarra', 'musica'], ['piano', 'Piano', 'musica'],
    ['camera', 'Fotografia', 'camara'], ['palette', 'Arte', 'pintura'], ['tent-tree', 'Campamento', 'acampar'],
    ['mountain-snow', 'Montana', 'excursion'], ['sailboat', 'Velero', 'navegar'], ['party-popper', 'Fiesta', 'celebracion'],
  ]),
  C('Naturaleza y clima', 'cloud-sun', [
    ['sun', 'Soleado', 'sol dia'], ['cloud', 'Nublado', 'nube'], ['cloud-sun', 'Parcialmente nublado', 'clima'],
    ['cloud-lightning', 'Tormenta', 'rayo'], ['cloud-snow', 'Nieve', 'frio'], ['umbrella', 'Paraguas', 'lluvia'],
    ['rainbow', 'Arcoiris', 'colores'], ['sunrise', 'Amanecer', 'manana'], ['sunset', 'Atardecer', 'tarde'],
    ['tree-pine', 'Pino', 'arbol bosque'], ['tree-palm', 'Palmera', 'playa'], ['sprout', 'Brote', 'crecer planta'],
    ['flower', 'Flor', 'jardin'], ['clover', 'Trebol', 'suerte'], ['dog', 'Perro', 'mascota'],
    ['cat', 'Gato', 'mascota'], ['bird', 'Ave', 'pajaro'], ['bug', 'Insecto', 'error bicho'],
    ['paw-print', 'Mascotas', 'huella animal'], ['earth', 'Planeta', 'tierra mundo'], ['mountain', 'Montana', 'paisaje'],
  ]),
  C('Tecnologia y desarrollo', 'code', [
    ['code', 'Codigo', 'programar'], ['braces', 'Llaves', 'json objeto'], ['bot', 'Bot', 'asistente robot ia'],
    ['cloud-upload', 'Subir a la nube', 'respaldo'], ['cloud-download', 'Descargar', 'nube'], ['hard-drive-download', 'Respaldo', 'backup'],
    ['shield-check', 'Seguridad', 'protegido'], ['key-square', 'Credencial', 'acceso api'], ['webhook', 'Webhook', 'integracion'],
    ['plug-zap', 'Integracion', 'conectar'], ['blocks', 'Modulos', 'bloques componentes'], ['layout-dashboard', 'Tablero', 'dashboard'],
    ['app-window', 'Aplicacion', 'ventana'], ['smartphone', 'App movil', 'celular'], ['qr-code', 'Codigo QR', 'escaneo'],
    ['bug', 'Error', 'bug falla'], ['git-pull-request', 'Revision', 'pull request'], ['container', 'Contenedor', 'docker'],
  ]),
]

const seen = new Set()
export const CURATED_ICONS = ICON_CATEGORIES.flatMap((category) => category.items.map((item) => ({ ...item, category: category.label })))
  .filter((item) => (seen.has(item.name) ? false : seen.add(item.name)))

export const iconLabel = (name) => CURATED_ICONS.find((item) => item.name === name)?.label ?? name

const normalize = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function searchCurated(query, category = null) {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  // A category shows its full list (an icon may belong to several); a search
  // runs over the de-duplicated catalog.
  const source = category ? ICON_CATEGORIES.find((item) => item.label === category)?.items ?? [] : CURATED_ICONS
  return source.filter((item) => {
    if (!terms.length) return true
    const haystack = normalize(`${item.label} ${item.keywords} ${item.name.replace(/-/g, ' ')}`)
    return terms.every((term) => haystack.includes(term))
  })
}
