// Curated hotspot icon library: lucide icon names (kebab-case, as stored in
// CanvasHotspot.icon) grouped by what people mark on plans and technical
// maps, with Spanish labels and search keywords. Any other lucide icon is
// still selectable from the "Todos" tab; names are resolved lazily through
// lucide-react/dynamicIconImports, so none of this costs bundle size upfront.
const C = (label, items) => ({ label, items: items.map(([name, es, keywords = '']) => ({ name, label: es, keywords })) })

export const ICON_CATEGORIES = [
  C('Seguridad y emergencias', [
    ['fire-extinguisher', 'Extintor', 'incendio fuego'], ['flame', 'Fuego', 'incendio llama calor'], ['siren', 'Alarma', 'sirena emergencia'],
    ['bell-ring', 'Timbre de alarma', 'alerta campana'], ['shield-alert', 'Riesgo', 'peligro seguridad'], ['shield-check', 'Zona segura', 'seguridad protegido'],
    ['triangle-alert', 'Advertencia', 'peligro precaucion'], ['octagon-alert', 'Alto', 'stop detener'], ['cctv', 'Camara de seguridad', 'vigilancia cctv video'],
    ['door-open', 'Salida', 'puerta emergencia evacuacion'], ['door-closed', 'Puerta', 'acceso'], ['lock', 'Cerrado', 'candado seguridad acceso'],
    ['key-round', 'Llave', 'acceso llaves'], ['hard-hat', 'Casco', 'epp proteccion obra'], ['heart-pulse', 'Primeros auxilios', 'botiquin salud desfibrilador'],
    ['cross', 'Enfermeria', 'medico cruz salud'], ['life-buoy', 'Salvavidas', 'rescate'], ['radiation', 'Radiacion', 'peligro'],
    ['biohazard', 'Riesgo biologico', 'peligro'], ['skull', 'Peligro', 'toxico veneno'], ['footprints', 'Ruta de evacuacion', 'pasos camino'],
    ['scan-face', 'Control de acceso', 'reconocimiento facial'], ['fingerprint', 'Huella', 'biometrico acceso'], ['badge-alert', 'Incidente', 'alerta'],
  ]),
  C('Electricidad y energia', [
    ['zap', 'Electricidad', 'energia rayo corriente'], ['plug', 'Contacto', 'enchufe toma'], ['plug-zap', 'Toma electrica', 'enchufe corriente'],
    ['power', 'Interruptor', 'encendido apagado'], ['toggle-right', 'Apagador', 'switch interruptor'], ['cable', 'Cable', 'cableado'],
    ['battery-charging', 'Bateria', 'carga ups'], ['battery-full', 'UPS', 'bateria respaldo'], ['lightbulb', 'Lampara', 'luz foco iluminacion'],
    ['lamp-ceiling', 'Luminaria', 'luz techo iluminacion'], ['lamp', 'Lampara de mesa', 'luz'], ['sun', 'Solar', 'panel sol luz'],
    ['solar-panel', 'Panel solar', 'energia solar fotovoltaico'], ['gauge', 'Medidor', 'contador manometro'], ['activity', 'Monitoreo', 'senal actividad'],
    ['circuit-board', 'Tablero', 'circuito placa control'], ['fuel', 'Combustible', 'gasolina diesel planta'], ['plug-2', 'Clavija', 'enchufe'], ['bell-electric', 'Timbre', 'campana electrica'],
  ]),
  C('Agua, gas y climatizacion', [
    ['droplet', 'Agua', 'gota fuga'], ['droplets', 'Humedad', 'goteo fuga'], ['waves', 'Inundacion', 'agua nivel'],
    ['shower-head', 'Regadera', 'bano ducha'], ['bath', 'Bano', 'tina sanitario'], ['toilet', 'Sanitario', 'bano wc inodoro'],
    ['heater', 'Calentador', 'boiler agua caliente'], ['thermometer', 'Temperatura', 'termometro calor frio'], ['snowflake', 'Refrigeracion', 'frio aire acondicionado'],
    ['fan', 'Ventilador', 'extractor aire'], ['air-vent', 'Ventilacion', 'aire acondicionado rejilla'], ['wind', 'Aire', 'viento ventilacion'],
    ['cloud-rain', 'Lluvia', 'pluvial drenaje'], ['flame-kindling', 'Gas', 'estufa calentador'], ['container', 'Tanque', 'cisterna deposito'],
    ['milk', 'Garrafon', 'agua purificada'], ['glass-water', 'Bebedero', 'agua potable'], ['spray-can', 'Limpieza', 'aerosol quimico'],
  ]),
  C('Redes y tecnologia', [
    ['wifi', 'Wifi', 'internet red inalambrico'], ['router', 'Router', 'red internet modem'], ['server', 'Servidor', 'site rack datos'],
    ['network', 'Red', 'switch conexion'], ['ethernet-port', 'Nodo de red', 'puerto ethernet cable datos'], ['hard-drive', 'Almacenamiento', 'disco nas'],
    ['monitor', 'Monitor', 'pantalla computadora'], ['laptop', 'Laptop', 'computadora portatil'], ['printer', 'Impresora', 'impresion'],
    ['phone', 'Telefono', 'extension llamada'], ['smartphone', 'Celular', 'movil'], ['tv', 'Television', 'pantalla'],
    ['projector', 'Proyector', 'sala juntas'], ['webcam', 'Camara web', 'video'], ['radio', 'Radio', 'antena comunicacion'],
    ['satellite-dish', 'Antena', 'satelital parabolica'], ['cpu', 'Equipo', 'procesador hardware'], ['qr-code', 'Codigo QR', 'escaneo etiqueta'],
    ['scan-barcode', 'Lector', 'codigo de barras escaner'], ['bluetooth', 'Bluetooth', 'inalambrico'], ['speaker', 'Bocina', 'audio sonido'],
  ]),
  C('Oficina y mobiliario', [
    ['armchair', 'Sillon', 'mueble silla'], ['sofa', 'Sala', 'sofa mueble'], ['bed', 'Cama', 'dormitorio habitacion'],
    ['lamp-desk', 'Escritorio', 'mesa trabajo'], ['presentation', 'Sala de juntas', 'presentacion reunion'], ['book-open', 'Biblioteca', 'libros archivo'],
    ['archive', 'Archivo', 'archivero documentos'], ['inbox', 'Recepcion', 'buzon entrada'], ['clipboard', 'Registro', 'checklist'],
    ['file-text', 'Documento', 'archivo papel'], ['folder', 'Carpeta', 'archivo'], ['coffee', 'Cafeteria', 'cafe comedor'],
    ['utensils', 'Comedor', 'cocina comida'], ['refrigerator', 'Refrigerador', 'cocina'], ['microwave', 'Microondas', 'cocina'],
    ['trash-2', 'Basura', 'bote residuos'], ['recycle', 'Reciclaje', 'residuos'], ['shirt', 'Vestidor', 'ropa uniforme'],
    ['clock', 'Reloj', 'checador hora'], ['calendar', 'Agenda', 'calendario'], ['mail', 'Correo', 'buzon paqueteria'],
  ]),
  C('Almacen y logistica', [
    ['package', 'Paquete', 'caja producto'], ['boxes', 'Inventario', 'cajas almacen stock'], ['warehouse', 'Almacen', 'bodega'],
    ['carton', 'Caja de carton', 'empaque'], ['forklift', 'Montacargas', 'carga'], ['truck', 'Camion', 'reparto transporte'],
    ['container', 'Contenedor', 'deposito'], ['shelving-unit', 'Estanteria', 'rack anaquel'], ['layers', 'Niveles', 'pisos capas'],
    ['scale', 'Bascula', 'peso balanza'], ['tag', 'Etiqueta', 'precio sku'], ['barcode', 'Codigo de barras', 'sku producto'],
    ['shopping-cart', 'Carrito', 'compras'], ['package-check', 'Recibido', 'entregado paquete'], ['package-x', 'Faltante', 'paquete error'],
    ['truck-electric', 'Vehiculo electrico de carga', 'reparto'], ['map-pin', 'Ubicacion', 'punto lugar'], ['navigation', 'Ruta', 'direccion'],
  ]),
  C('Herramientas y mantenimiento', [
    ['wrench', 'Mantenimiento', 'herramienta llave reparacion'], ['hammer', 'Martillo', 'herramienta reparacion'], ['drill', 'Taladro', 'herramienta'],
    ['tool-case', 'Estuche de herramientas', 'kit'], ['ruler', 'Medida', 'regla metro'], ['paint-roller', 'Pintura', 'rodillo'],
    ['paintbrush', 'Brocha', 'pintura'], ['construction', 'Obra', 'construccion trabajos'], ['traffic-cone', 'Cono', 'precaucion obra'],
    ['cog', 'Maquinaria', 'engrane mecanismo'], ['settings', 'Configuracion', 'ajustes engrane'], ['factory', 'Planta', 'fabrica industria'],
    ['pickaxe', 'Excavacion', 'pico'], ['shovel', 'Pala', 'jardineria'], ['brush-cleaning', 'Aseo', 'limpieza escoba'],
    ['waves-ladder', 'Alberca', 'piscina escalera'], ['toolbox', 'Caja de herramientas', 'herramientas'], ['pipette', 'Muestra', 'laboratorio'],
  ]),
  C('Vehiculos y transporte', [
    ['car', 'Auto', 'vehiculo carro'], ['car-front', 'Estacionamiento', 'vehiculo cajon'], ['bus', 'Autobus', 'transporte'],
    ['truck', 'Camion', 'carga'], ['bike', 'Bicicleta', 'ciclista'], ['motorbike', 'Motocicleta', 'moto'],
    ['circle-parking', 'Parking', 'estacionamiento'], ['fuel', 'Gasolinera', 'combustible'], ['ev-charger', 'Cargador electrico', 'vehiculo electrico'],
    ['plane', 'Avion', 'aeropuerto'], ['ship', 'Barco', 'puerto'], ['train-front', 'Tren', 'estacion'],
    ['tractor', 'Tractor', 'campo agricola'], ['caravan', 'Remolque', 'caravana'], ['ship-wheel', 'Timon', 'nautico'],
  ]),
  C('Personas', [
    ['user', 'Persona', 'usuario empleado'], ['users', 'Equipo', 'personas grupo'], ['user-round-check', 'Responsable', 'encargado asignado'],
    ['contact', 'Contacto', 'directorio'], ['baby', 'Lactario', 'bebe'], ['accessibility', 'Accesibilidad', 'discapacidad rampa'],
    ['person-standing', 'Personal', 'trabajador'], ['hand-helping', 'Atencion', 'ayuda servicio'], ['graduation-cap', 'Capacitacion', 'escuela aula'],
    ['stethoscope', 'Medico', 'consultorio salud'], ['dumbbell', 'Gimnasio', 'ejercicio'], ['smile', 'Cliente', 'satisfaccion'],
  ]),
  C('Lugares y edificios', [
    ['building', 'Edificio', 'oficinas'], ['building-2', 'Corporativo', 'edificio'], ['house', 'Casa', 'hogar'],
    ['store', 'Tienda', 'local sucursal'], ['school', 'Escuela', 'aula'], ['hospital', 'Hospital', 'clinica'],
    ['hotel', 'Hotel', 'hospedaje'], ['landmark', 'Gobierno', 'banco institucion'], ['church', 'Iglesia', 'templo'],
    ['tent', 'Carpa', 'evento campamento'], ['fence', 'Barda', 'reja cerca'], ['trees', 'Area verde', 'jardin arboles'],
    ['flower-2', 'Jardin', 'flores'], ['mountain', 'Terreno', 'montana'], ['map', 'Mapa', 'plano zona'],
    ['compass', 'Orientacion', 'brujula norte'], ['flag', 'Punto de reunion', 'bandera marca'], ['door-stairwell', 'Escaleras', 'escalera piso cubo'],
    ['arrow-up-down', 'Elevador', 'ascensor'], ['grid-3x3', 'Area', 'zona cuadricula'], ['square-dashed', 'Zona', 'area delimitada'],
  ]),
  C('Estados y senales', [
    ['circle-check', 'Listo', 'correcto ok completado'], ['circle-x', 'Falla', 'error'], ['circle-alert', 'Atencion', 'alerta'],
    ['circle-help', 'Duda', 'pregunta'], ['info', 'Informacion', 'info'], ['circle-pause', 'En pausa', 'detenido'],
    ['circle-dot', 'Punto', 'marca'], ['star', 'Importante', 'favorito destacado'], ['bookmark', 'Marcador', 'guardar'],
    ['eye', 'Revisar', 'inspeccion ver'], ['search', 'Inspeccion', 'buscar revisar'], ['message-circle', 'Comentario', 'nota observacion'],
    ['sticky-note', 'Nota', 'post-it'], ['camera', 'Foto', 'evidencia fotografia'], ['image', 'Imagen', 'foto'],
    ['clipboard-check', 'Inspeccionado', 'checklist verificado'], ['hourglass', 'Pendiente', 'espera tiempo'], ['ban', 'Prohibido', 'no permitido'],
    ['thumbs-up', 'Aprobado', 'ok'], ['thumbs-down', 'Rechazado', 'mal'], ['hash', 'Numero', 'identificador'],
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
