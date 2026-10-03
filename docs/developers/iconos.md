---
title: Iconos
summary: Iconos de lucide-react disponibles en Runly, agrupados por uso con su nombre en español, y la lista completa de nombres.
order: 2.6
---
Runly usa los iconos de [lucide](https://lucide.dev). Úsalos en títulos de sección, botones, estados vacíos, indicadores y en el menú del módulo; no uses emojis.

```jsx
import { Truck, FileText } from 'lucide-react'

<CardTitle className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" /> Entregas</CardTitle>
<StatCard label="Pendientes" value={7} icon={FileText} />   // StatCard y EmptyState reciben el componente, no <Icono />
```

- **En componentes React** importa el nombre en *PascalCase* (columna *Componente*).
- **En `module.manifest.js`** (`navigation[].icon`) usa también el nombre en *PascalCase*: `icon: 'Truck'`.
- **Si el icono viene de datos**, guarda el nombre en *kebab-case* (columna *Nombre*) y dibújalo con `IconGlyph` de `@runly/ui`.

Abajo están los 391 iconos recomendados por categoría y, al final, los 1486 restantes.

## Recomendados por categoría

### Ideas, trabajo y estudio

| Componente | Nombre | Uso |
|---|---|---|
| `NotebookPen` | `notebook-pen` | Cuaderno |
| `BookOpen` | `book-open` | Libro |
| `FileText` | `file-text` | Documento |
| `Lightbulb` | `lightbulb` | Idea |
| `Brain` | `brain` | Pensamiento |
| `Sparkles` | `sparkles` | Destacado |
| `Star` | `star` | Favorito |
| `Heart` | `heart` | Personal |
| `Bookmark` | `bookmark` | Marcador |
| `Pen` | `pen` | Escritura |
| `ClipboardList` | `clipboard-list` | Lista |
| `ListTodo` | `list-todo` | Tareas |
| `SquareCheck` | `square-check` | Hecho |
| `Briefcase` | `briefcase` | Trabajo |
| `Target` | `target` | Objetivo |
| `Rocket` | `rocket` | Lanzamiento |
| `Trophy` | `trophy` | Logro |
| `Flag` | `flag` | Hito |
| `Flame` | `flame` | Urgente |
| `Zap` | `zap` | Rapido |
| `Calendar` | `calendar` | Agenda |
| `Clock` | `clock` | Tiempo |
| `Bell` | `bell` | Recordatorio |
| `Mail` | `mail` | Correo |
| `MessageSquare` | `message-square` | Conversacion |
| `Users` | `users` | Reunion |
| `GraduationCap` | `graduation-cap` | Estudio |
| `CodeXml` | `code-xml` | Codigo |
| `Terminal` | `terminal` | Terminal |
| `Database` | `database` | Base de datos |
| `GitBranch` | `git-branch` | Version |
| `ChartColumn` | `chart-column` | Reporte |
| `TrendingUp` | `trending-up` | Crecimiento |
| `DollarSign` | `dollar-sign` | Dinero |
| `Plane` | `plane` | Viaje |
| `Coffee` | `coffee` | Pausa |
| `Music` | `music` | Musica |
| `Film` | `film` | Video |
| `Palette` | `palette` | Diseno |
| `Leaf` | `leaf` | Naturaleza |
| `Moon` | `moon` | Noche |
| `Gift` | `gift` | Regalo |

### Seguridad y emergencias

| Componente | Nombre | Uso |
|---|---|---|
| `FireExtinguisher` | `fire-extinguisher` | Extintor |
| `Flame` | `flame` | Fuego |
| `Siren` | `siren` | Alarma |
| `BellRing` | `bell-ring` | Timbre de alarma |
| `ShieldAlert` | `shield-alert` | Riesgo |
| `ShieldCheck` | `shield-check` | Zona segura |
| `TriangleAlert` | `triangle-alert` | Advertencia |
| `OctagonAlert` | `octagon-alert` | Alto |
| `Cctv` | `cctv` | Camara de seguridad |
| `DoorOpen` | `door-open` | Salida |
| `DoorClosed` | `door-closed` | Puerta |
| `Lock` | `lock` | Cerrado |
| `KeyRound` | `key-round` | Llave |
| `HardHat` | `hard-hat` | Casco |
| `HeartPulse` | `heart-pulse` | Primeros auxilios |
| `Cross` | `cross` | Enfermeria |
| `LifeBuoy` | `life-buoy` | Salvavidas |
| `Radiation` | `radiation` | Radiacion |
| `Biohazard` | `biohazard` | Riesgo biologico |
| `Skull` | `skull` | Peligro |
| `Footprints` | `footprints` | Ruta de evacuacion |
| `ScanFace` | `scan-face` | Control de acceso |
| `Fingerprint` | `fingerprint` | Huella |
| `BadgeAlert` | `badge-alert` | Incidente |

### Electricidad y energia

| Componente | Nombre | Uso |
|---|---|---|
| `Zap` | `zap` | Electricidad |
| `Plug` | `plug` | Contacto |
| `PlugZap` | `plug-zap` | Toma electrica |
| `Power` | `power` | Interruptor |
| `ToggleRight` | `toggle-right` | Apagador |
| `Cable` | `cable` | Cable |
| `BatteryCharging` | `battery-charging` | Bateria |
| `BatteryFull` | `battery-full` | UPS |
| `Lightbulb` | `lightbulb` | Lampara |
| `LampCeiling` | `lamp-ceiling` | Luminaria |
| `Lamp` | `lamp` | Lampara de mesa |
| `Sun` | `sun` | Solar |
| `SolarPanel` | `solar-panel` | Panel solar |
| `Gauge` | `gauge` | Medidor |
| `Activity` | `activity` | Monitoreo |
| `CircuitBoard` | `circuit-board` | Tablero |
| `Fuel` | `fuel` | Combustible |
| `Plug2` | `plug-2` | Clavija |
| `BellElectric` | `bell-electric` | Timbre |

### Agua, gas y climatizacion

| Componente | Nombre | Uso |
|---|---|---|
| `Droplet` | `droplet` | Agua |
| `Droplets` | `droplets` | Humedad |
| `Waves` | `waves` | Inundacion |
| `ShowerHead` | `shower-head` | Regadera |
| `Bath` | `bath` | Bano |
| `Toilet` | `toilet` | Sanitario |
| `Heater` | `heater` | Calentador |
| `Thermometer` | `thermometer` | Temperatura |
| `Snowflake` | `snowflake` | Refrigeracion |
| `Fan` | `fan` | Ventilador |
| `AirVent` | `air-vent` | Ventilacion |
| `Wind` | `wind` | Aire |
| `CloudRain` | `cloud-rain` | Lluvia |
| `FlameKindling` | `flame-kindling` | Gas |
| `Container` | `container` | Tanque |
| `Milk` | `milk` | Garrafon |
| `GlassWater` | `glass-water` | Bebedero |
| `SprayCan` | `spray-can` | Limpieza |

### Redes y tecnologia

| Componente | Nombre | Uso |
|---|---|---|
| `Wifi` | `wifi` | Wifi |
| `Router` | `router` | Router |
| `Server` | `server` | Servidor |
| `Network` | `network` | Red |
| `EthernetPort` | `ethernet-port` | Nodo de red |
| `HardDrive` | `hard-drive` | Almacenamiento |
| `Monitor` | `monitor` | Monitor |
| `Laptop` | `laptop` | Laptop |
| `Printer` | `printer` | Impresora |
| `Phone` | `phone` | Telefono |
| `Smartphone` | `smartphone` | Celular |
| `Tv` | `tv` | Television |
| `Projector` | `projector` | Proyector |
| `Webcam` | `webcam` | Camara web |
| `Radio` | `radio` | Radio |
| `SatelliteDish` | `satellite-dish` | Antena |
| `Cpu` | `cpu` | Equipo |
| `QrCode` | `qr-code` | Codigo QR |
| `ScanBarcode` | `scan-barcode` | Lector |
| `Bluetooth` | `bluetooth` | Bluetooth |
| `Speaker` | `speaker` | Bocina |

### Oficina y mobiliario

| Componente | Nombre | Uso |
|---|---|---|
| `Armchair` | `armchair` | Sillon |
| `Sofa` | `sofa` | Sala |
| `Bed` | `bed` | Cama |
| `LampDesk` | `lamp-desk` | Escritorio |
| `Presentation` | `presentation` | Sala de juntas |
| `BookOpen` | `book-open` | Biblioteca |
| `Archive` | `archive` | Archivo |
| `Inbox` | `inbox` | Recepcion |
| `Clipboard` | `clipboard` | Registro |
| `FileText` | `file-text` | Documento |
| `Folder` | `folder` | Carpeta |
| `Coffee` | `coffee` | Cafeteria |
| `Utensils` | `utensils` | Comedor |
| `Refrigerator` | `refrigerator` | Refrigerador |
| `Microwave` | `microwave` | Microondas |
| `Trash2` | `trash-2` | Basura |
| `Recycle` | `recycle` | Reciclaje |
| `Shirt` | `shirt` | Vestidor |
| `Clock` | `clock` | Reloj |
| `Calendar` | `calendar` | Agenda |
| `Mail` | `mail` | Correo |

### Almacen y logistica

| Componente | Nombre | Uso |
|---|---|---|
| `Package` | `package` | Paquete |
| `Boxes` | `boxes` | Inventario |
| `Warehouse` | `warehouse` | Almacen |
| `Carton` | `carton` | Caja de carton |
| `Forklift` | `forklift` | Montacargas |
| `Truck` | `truck` | Camion |
| `Container` | `container` | Contenedor |
| `ShelvingUnit` | `shelving-unit` | Estanteria |
| `Layers` | `layers` | Niveles |
| `Scale` | `scale` | Bascula |
| `Tag` | `tag` | Etiqueta |
| `Barcode` | `barcode` | Codigo de barras |
| `ShoppingCart` | `shopping-cart` | Carrito |
| `PackageCheck` | `package-check` | Recibido |
| `PackageX` | `package-x` | Faltante |
| `TruckElectric` | `truck-electric` | Vehiculo electrico de carga |
| `MapPin` | `map-pin` | Ubicacion |
| `Navigation` | `navigation` | Ruta |

### Herramientas y mantenimiento

| Componente | Nombre | Uso |
|---|---|---|
| `Wrench` | `wrench` | Mantenimiento |
| `Hammer` | `hammer` | Martillo |
| `Drill` | `drill` | Taladro |
| `ToolCase` | `tool-case` | Estuche de herramientas |
| `Ruler` | `ruler` | Medida |
| `PaintRoller` | `paint-roller` | Pintura |
| `Paintbrush` | `paintbrush` | Brocha |
| `Construction` | `construction` | Obra |
| `TrafficCone` | `traffic-cone` | Cono |
| `Cog` | `cog` | Maquinaria |
| `Settings` | `settings` | Configuracion |
| `Factory` | `factory` | Planta |
| `Pickaxe` | `pickaxe` | Excavacion |
| `Shovel` | `shovel` | Pala |
| `BrushCleaning` | `brush-cleaning` | Aseo |
| `WavesLadder` | `waves-ladder` | Alberca |
| `Toolbox` | `toolbox` | Caja de herramientas |
| `Pipette` | `pipette` | Muestra |

### Vehiculos y transporte

| Componente | Nombre | Uso |
|---|---|---|
| `Car` | `car` | Auto |
| `CarFront` | `car-front` | Estacionamiento |
| `Bus` | `bus` | Autobus |
| `Truck` | `truck` | Camion |
| `Bike` | `bike` | Bicicleta |
| `Motorbike` | `motorbike` | Motocicleta |
| `CircleParking` | `circle-parking` | Parking |
| `Fuel` | `fuel` | Gasolinera |
| `EvCharger` | `ev-charger` | Cargador electrico |
| `Plane` | `plane` | Avion |
| `Ship` | `ship` | Barco |
| `TrainFront` | `train-front` | Tren |
| `Tractor` | `tractor` | Tractor |
| `Caravan` | `caravan` | Remolque |
| `ShipWheel` | `ship-wheel` | Timon |

### Personas

| Componente | Nombre | Uso |
|---|---|---|
| `User` | `user` | Persona |
| `Users` | `users` | Equipo |
| `UserRoundCheck` | `user-round-check` | Responsable |
| `Contact` | `contact` | Contacto |
| `Baby` | `baby` | Lactario |
| `Accessibility` | `accessibility` | Accesibilidad |
| `PersonStanding` | `person-standing` | Personal |
| `HandHelping` | `hand-helping` | Atencion |
| `GraduationCap` | `graduation-cap` | Capacitacion |
| `Stethoscope` | `stethoscope` | Medico |
| `Dumbbell` | `dumbbell` | Gimnasio |
| `Smile` | `smile` | Cliente |

### Lugares y edificios

| Componente | Nombre | Uso |
|---|---|---|
| `Building` | `building` | Edificio |
| `Building2` | `building-2` | Corporativo |
| `House` | `house` | Casa |
| `Store` | `store` | Tienda |
| `School` | `school` | Escuela |
| `Hospital` | `hospital` | Hospital |
| `Hotel` | `hotel` | Hotel |
| `Landmark` | `landmark` | Gobierno |
| `Church` | `church` | Iglesia |
| `Tent` | `tent` | Carpa |
| `Fence` | `fence` | Barda |
| `Trees` | `trees` | Area verde |
| `Flower2` | `flower-2` | Jardin |
| `Mountain` | `mountain` | Terreno |
| `Map` | `map` | Mapa |
| `Compass` | `compass` | Orientacion |
| `Flag` | `flag` | Punto de reunion |
| `DoorStairwell` | `door-stairwell` | Escaleras |
| `ArrowUpDown` | `arrow-up-down` | Elevador |
| `Grid3x3` | `grid-3x3` | Area |
| `SquareDashed` | `square-dashed` | Zona |

### Estados y senales

| Componente | Nombre | Uso |
|---|---|---|
| `CircleCheck` | `circle-check` | Listo |
| `CircleX` | `circle-x` | Falla |
| `CircleAlert` | `circle-alert` | Atencion |
| `CircleHelp` | `circle-help` | Duda |
| `Info` | `info` | Informacion |
| `CirclePause` | `circle-pause` | En pausa |
| `CircleDot` | `circle-dot` | Punto |
| `Star` | `star` | Importante |
| `Bookmark` | `bookmark` | Marcador |
| `Eye` | `eye` | Revisar |
| `Search` | `search` | Inspeccion |
| `MessageCircle` | `message-circle` | Comentario |
| `StickyNote` | `sticky-note` | Nota |
| `Camera` | `camera` | Foto |
| `Image` | `image` | Imagen |
| `ClipboardCheck` | `clipboard-check` | Inspeccionado |
| `Hourglass` | `hourglass` | Pendiente |
| `Ban` | `ban` | Prohibido |
| `ThumbsUp` | `thumbs-up` | Aprobado |
| `ThumbsDown` | `thumbs-down` | Rechazado |
| `Hash` | `hash` | Numero |

### Finanzas y comercio

| Componente | Nombre | Uso |
|---|---|---|
| `Wallet` | `wallet` | Cartera |
| `Banknote` | `banknote` | Efectivo |
| `Coins` | `coins` | Monedas |
| `PiggyBank` | `piggy-bank` | Ahorro |
| `CreditCard` | `credit-card` | Tarjeta |
| `Receipt` | `receipt` | Recibo |
| `ReceiptText` | `receipt-text` | Factura |
| `Landmark` | `landmark` | Banco |
| `HandCoins` | `hand-coins` | Pago |
| `BadgeDollarSign` | `badge-dollar-sign` | Precio |
| `BadgePercent` | `badge-percent` | Descuento |
| `Percent` | `percent` | Porcentaje |
| `Calculator` | `calculator` | Calculadora |
| `ChartLine` | `chart-line` | Tendencia |
| `ChartPie` | `chart-pie` | Distribucion |
| `ChartNoAxesColumnIncreasing` | `chart-no-axes-column-increasing` | Indicadores |
| `TrendingDown` | `trending-down` | Baja |
| `Scale` | `scale` | Balance |
| `ShoppingBag` | `shopping-bag` | Bolsa de compra |
| `ShoppingBasket` | `shopping-basket` | Canasta |
| `Store` | `store` | Tienda |
| `Handshake` | `handshake` | Acuerdo |
| `Gem` | `gem` | Premium |
| `Ticket` | `ticket` | Boleto |

### Comunicacion

| Componente | Nombre | Uso |
|---|---|---|
| `MessageCircle` | `message-circle` | Mensaje |
| `MessagesSquare` | `messages-square` | Conversaciones |
| `MailOpen` | `mail-open` | Correo leido |
| `Send` | `send` | Enviar |
| `Inbox` | `inbox` | Bandeja |
| `PhoneCall` | `phone-call` | Llamada |
| `Video` | `video` | Videollamada |
| `Mic` | `mic` | Microfono |
| `Megaphone` | `megaphone` | Anuncio |
| `AtSign` | `at-sign` | Arroba |
| `Share2` | `share-2` | Compartir |
| `Link` | `link` | Enlace |
| `Rss` | `rss` | Noticias |
| `Newspaper` | `newspaper` | Periodico |
| `Languages` | `languages` | Idiomas |
| `BellDot` | `bell-dot` | Notificacion |
| `Quote` | `quote` | Cita |
| `Voicemail` | `voicemail` | Buzon de voz |

### Documentos y archivos

| Componente | Nombre | Uso |
|---|---|---|
| `File` | `file` | Archivo |
| `FileCheck` | `file-check` | Aprobado |
| `FileSignature` | `file-signature` | Contrato |
| `FileSpreadsheet` | `file-spreadsheet` | Hoja de calculo |
| `FileImage` | `file-image` | Imagen |
| `FileVideo` | `file-video` | Video |
| `FileAudio` | `file-audio` | Audio |
| `FileCode` | `file-code` | Codigo |
| `FileLock` | `file-lock` | Confidencial |
| `Files` | `files` | Archivos |
| `FolderOpen` | `folder-open` | Carpeta abierta |
| `FolderKanban` | `folder-kanban` | Proyecto |
| `Notebook` | `notebook` | Libreta |
| `NotebookTabs` | `notebook-tabs` | Agenda |
| `Book` | `book` | Manual |
| `Library` | `library` | Biblioteca |
| `ScrollText` | `scroll-text` | Politica |
| `Signature` | `signature` | Firma |
| `Stamp` | `stamp` | Sello |
| `Printer` | `printer` | Imprimir |
| `Paperclip` | `paperclip` | Adjunto |

### Tiempo y planeacion

| Componente | Nombre | Uso |
|---|---|---|
| `CalendarDays` | `calendar-days` | Calendario |
| `CalendarCheck` | `calendar-check` | Evento confirmado |
| `CalendarClock` | `calendar-clock` | Programado |
| `CalendarRange` | `calendar-range` | Periodo |
| `AlarmClock` | `alarm-clock` | Alarma |
| `Timer` | `timer` | Temporizador |
| `Hourglass` | `hourglass` | Espera |
| `History` | `history` | Historial |
| `Repeat` | `repeat` | Recurrente |
| `Kanban` | `kanban` | Tablero |
| `ListChecks` | `list-checks` | Checklist |
| `ListOrdered` | `list-ordered` | Pasos |
| `Milestone` | `milestone` | Hito |
| `Goal` | `goal` | Meta |
| `Route` | `route` | Ruta |
| `GanttChart` | `gantt-chart` | Cronograma |
| `Workflow` | `workflow` | Flujo |
| `GitMerge` | `git-merge` | Integracion |

### Salud y bienestar

| Componente | Nombre | Uso |
|---|---|---|
| `HeartPulse` | `heart-pulse` | Salud |
| `Pill` | `pill` | Medicamento |
| `Syringe` | `syringe` | Vacuna |
| `Thermometer` | `thermometer` | Fiebre |
| `Activity` | `activity` | Signos vitales |
| `Brain` | `brain` | Salud mental |
| `Bone` | `bone` | Hueso |
| `Ear` | `ear` | Oido |
| `Eye` | `eye` | Vision |
| `HandHeart` | `hand-heart` | Cuidado |
| `Apple` | `apple` | Nutricion |
| `BedDouble` | `bed-double` | Descanso |
| `Dumbbell` | `dumbbell` | Ejercicio |
| `Footprints` | `footprints` | Caminata |
| `Smile` | `smile` | Bienestar |
| `Ambulance` | `ambulance` | Ambulancia |
| `Hospital` | `hospital` | Clinica |
| `Microscope` | `microscope` | Laboratorio |

### Comida y bebida

| Componente | Nombre | Uso |
|---|---|---|
| `UtensilsCrossed` | `utensils-crossed` | Restaurante |
| `ChefHat` | `chef-hat` | Cocina |
| `CookingPot` | `cooking-pot` | Guiso |
| `Pizza` | `pizza` | Pizza |
| `Sandwich` | `sandwich` | Sandwich |
| `Salad` | `salad` | Ensalada |
| `Soup` | `soup` | Sopa |
| `Beef` | `beef` | Carne |
| `Fish` | `fish` | Pescado |
| `Croissant` | `croissant` | Panaderia |
| `Cake` | `cake` | Pastel |
| `IceCreamCone` | `ice-cream-cone` | Helado |
| `Cookie` | `cookie` | Galleta |
| `Egg` | `egg` | Huevo |
| `Carrot` | `carrot` | Verdura |
| `Coffee` | `coffee` | Cafe |
| `CupSoda` | `cup-soda` | Refresco |
| `Wine` | `wine` | Vino |
| `Beer` | `beer` | Cerveza |
| `Martini` | `martini` | Coctel |
| `GlassWater` | `glass-water` | Agua |

### Educacion y ciencia

| Componente | Nombre | Uso |
|---|---|---|
| `GraduationCap` | `graduation-cap` | Graduacion |
| `School` | `school` | Escuela |
| `BookOpenCheck` | `book-open-check` | Leccion |
| `LibraryBig` | `library-big` | Acervo |
| `Pencil` | `pencil` | Lapiz |
| `PencilRuler` | `pencil-ruler` | Diseno tecnico |
| `NotebookPen` | `notebook-pen` | Apuntes |
| `Presentation` | `presentation` | Clase |
| `Award` | `award` | Reconocimiento |
| `Medal` | `medal` | Medalla |
| `FlaskConical` | `flask-conical` | Quimica |
| `Atom` | `atom` | Fisica |
| `Dna` | `dna` | Biologia |
| `Telescope` | `telescope` | Astronomia |
| `Sigma` | `sigma` | Matematicas |
| `Globe` | `globe` | Geografia |
| `Puzzle` | `puzzle` | Reto |
| `BrainCircuit` | `brain-circuit` | Inteligencia artificial |

### Deportes y ocio

| Componente | Nombre | Uso |
|---|---|---|
| `Trophy` | `trophy` | Campeonato |
| `Volleyball` | `volleyball` | Voleibol |
| `Goal` | `goal` | Futbol |
| `Bike` | `bike` | Ciclismo |
| `Dumbbell` | `dumbbell` | Gimnasio |
| `Gamepad2` | `gamepad-2` | Videojuegos |
| `Dice5` | `dice-5` | Juegos |
| `Drama` | `drama` | Teatro |
| `Clapperboard` | `clapperboard` | Cine |
| `Headphones` | `headphones` | Audio |
| `Guitar` | `guitar` | Guitarra |
| `Piano` | `piano` | Piano |
| `Camera` | `camera` | Fotografia |
| `Palette` | `palette` | Arte |
| `TentTree` | `tent-tree` | Campamento |
| `MountainSnow` | `mountain-snow` | Montana |
| `Sailboat` | `sailboat` | Velero |
| `PartyPopper` | `party-popper` | Fiesta |

### Naturaleza y clima

| Componente | Nombre | Uso |
|---|---|---|
| `Sun` | `sun` | Soleado |
| `Cloud` | `cloud` | Nublado |
| `CloudSun` | `cloud-sun` | Parcialmente nublado |
| `CloudLightning` | `cloud-lightning` | Tormenta |
| `CloudSnow` | `cloud-snow` | Nieve |
| `Umbrella` | `umbrella` | Paraguas |
| `Rainbow` | `rainbow` | Arcoiris |
| `Sunrise` | `sunrise` | Amanecer |
| `Sunset` | `sunset` | Atardecer |
| `TreePine` | `tree-pine` | Pino |
| `TreePalm` | `tree-palm` | Palmera |
| `Sprout` | `sprout` | Brote |
| `Flower` | `flower` | Flor |
| `Clover` | `clover` | Trebol |
| `Dog` | `dog` | Perro |
| `Cat` | `cat` | Gato |
| `Bird` | `bird` | Ave |
| `Bug` | `bug` | Insecto |
| `PawPrint` | `paw-print` | Mascotas |
| `Earth` | `earth` | Planeta |
| `Mountain` | `mountain` | Montana |

### Tecnologia y desarrollo

| Componente | Nombre | Uso |
|---|---|---|
| `Code` | `code` | Codigo |
| `Braces` | `braces` | Llaves |
| `Bot` | `bot` | Bot |
| `CloudUpload` | `cloud-upload` | Subir a la nube |
| `CloudDownload` | `cloud-download` | Descargar |
| `HardDriveDownload` | `hard-drive-download` | Respaldo |
| `ShieldCheck` | `shield-check` | Seguridad |
| `KeySquare` | `key-square` | Credencial |
| `Webhook` | `webhook` | Webhook |
| `PlugZap` | `plug-zap` | Integracion |
| `Blocks` | `blocks` | Modulos |
| `LayoutDashboard` | `layout-dashboard` | Tablero |
| `AppWindow` | `app-window` | Aplicacion |
| `Smartphone` | `smartphone` | App movil |
| `QrCode` | `qr-code` | Codigo QR |
| `Bug` | `bug` | Error |
| `GitPullRequest` | `git-pull-request` | Revision |
| `Container` | `container` | Contenedor |

## Todos los demás

`AArrowDown` · `AArrowUp` · `ALargeSmall` · `Ad` · `Airplay` · `AlarmClockCheck` · `AlarmClockMinus` · `AlarmClockOff` · `AlarmClockPlus` · `AlarmSmoke` · `AlignCenterHorizontal` · `AlignCenterVertical` · `AlignEndHorizontal` · `AlignEndVertical` · `AlignHorizontalDistributeCenter` · `AlignHorizontalDistributeEnd` · `AlignHorizontalDistributeStart` · `AlignHorizontalJustifyCenter` · `AlignHorizontalJustifyEnd` · `AlignHorizontalJustifyStart` · `AlignHorizontalSpaceAround` · `AlignHorizontalSpaceBetween` · `AlignStartHorizontal` · `AlignStartVertical` · `AlignVerticalDistributeCenter` · `AlignVerticalDistributeEnd` · `AlignVerticalDistributeStart` · `AlignVerticalJustifyCenter` · `AlignVerticalJustifyEnd` · `AlignVerticalJustifyStart` · `AlignVerticalSpaceAround` · `AlignVerticalSpaceBetween` · `Ampersand` · `Ampersands` · `Amphora` · `Anchor` · `Angle` · `Antenna` · `Anvil` · `Aperture` · `AppWindowMac` · `ArchiveRestore` · `ArchiveX` · `ArmenianDram` · `ArrowBigDown` · `ArrowBigDownDash` · `ArrowBigLeft` · `ArrowBigLeftDash` · `ArrowBigRight` · `ArrowBigRightDash` · `ArrowBigUp` · `ArrowBigUpDash` · `ArrowDown` · `ArrowDown01` · `ArrowDown10` · `ArrowDownAZ` · `ArrowDownFromLine` · `ArrowDownLeft` · `ArrowDownNarrowWide` · `ArrowDownRight` · `ArrowDownToDot` · `ArrowDownToLine` · `ArrowDownUp` · `ArrowDownWideNarrow` · `ArrowDownZA` · `ArrowLeft` · `ArrowLeftFromLine` · `ArrowLeftRight` · `ArrowLeftToLine` · `ArrowRight` · `ArrowRightFromLine` · `ArrowRightLeft` · `ArrowRightToLine` · `ArrowUp` · `ArrowUp01` · `ArrowUp10` · `ArrowUpAZ` · `ArrowUpFromDot` · `ArrowUpFromLine` · `ArrowUpLeft` · `ArrowUpNarrowWide` · `ArrowUpRight` · `ArrowUpToLine` · `ArrowUpWideNarrow` · `ArrowUpZA` · `ArrowsUpFromLine` · `Asterisk` · `Astroid` · `AudioLines` · `AudioLinesOff` · `AudioLinesX` · `AudioWaveform` · `Axe` · `Axis3d` · `Backpack` · `Badge` · `BadgeCent` · `BadgeCheck` · `BadgeEuro` · `BadgeIndianRupee` · `BadgeInfo` · `BadgeJapaneseYen` · `BadgeMinus` · `BadgePlus` · `BadgePoundSterling` · `BadgeQuestionMark` · `BadgeRussianRuble` · `BadgeSwissFranc` · `BadgeTurkishLira` · `BadgeX` · `BaggageClaim` · `Balloon` · `Banana` · `Bandage` · `BangladeshiTaka` · `BanknoteArrowDown` · `BanknoteArrowUp` · `BanknoteCheck` · `BanknoteX` · `Barrel` · `Baseline` · `Battery` · `BatteryLow` · `BatteryMedium` · `BatteryPlus` · `BatteryWarning` · `Beaker` · `Bean` · `BeanOff` · `BedSingle` · `BeefOff` · `BeerOff` · `BellCheck` · `BellMinus` · `BellOff` · `BellPlus` · `BetweenHorizontalEnd` · `BetweenHorizontalStart` · `BetweenVerticalEnd` · `BetweenVerticalStart` · `BicepsFlexed` · `Binary` · `Binoculars` · `Birdhouse` · `Bitcoin` · `Blend` · `Blender` · `Blinds` · `BluetoothConnected` · `BluetoothOff` · `BluetoothSearching` · `Bold` · `Bolt` · `Bomb` · `BoneFracture` · `BookA` · `BookAlert` · `BookAudio` · `BookBookmark` · `BookCheck` · `BookCopy` · `BookDashed` · `BookDown` · `BookHeadphones` · `BookHeart` · `BookImage` · `BookKey` · `BookLock` · `BookMinus` · `BookOpenText` · `BookPlus` · `BookSearch` · `BookText` · `BookType` · `BookUp` · `BookUp2` · `BookUser` · `BookX` · `BookmarkCheck` · `BookmarkMinus` · `BookmarkOff` · `BookmarkPlus` · `BookmarkX` · `BoomBox` · `BotMessageSquare` · `BotOff` · `BottleWine` · `BowArrow` · `Box` · `Brackets` · `BrainCog` · `BrickWall` · `BrickWallFire` · `BrickWallShield` · `Bridge` · `BriefcaseBusiness` · `BriefcaseConveyorBelt` · `BriefcaseMedical` · `BriefcasePlus` · `BringToFront` · `Broccoli` · `Broom` · `BroomSparkles` · `Brush` · `Bubbles` · `BugOff` · `BugPlay` · `BuildingComplex` · `BuildingComplexPlus` · `BusFront` · `CableCar` · `CakeSlice` · `Calendar1` · `CalendarArrowDown` · `CalendarArrowUp` · `CalendarCheck2` · `CalendarChevronsRight` · `CalendarCog` · `CalendarFold` · `CalendarHeart` · `CalendarMinus` · `CalendarMinus2` · `CalendarOff` · `CalendarPlus` · `CalendarPlus2` · `CalendarSearch` · `CalendarSync` · `CalendarX` · `CalendarX2` · `Calendars` · `CameraOff` · `Can` · `CanSoda` · `Candy` · `CandyCane` · `CandyOff` · `Cannabis` · `CannabisOff` · `Captions` · `CaptionsOff` · `CarBattery` · `CarTaxiFront` · `CardSim` · `CartonOff` · `CaseLower` · `CaseSensitive` · `CaseUpper` · `CassetteTape` · `Cast` · `Castle` · `CctvOff` · `ChartArea` · `ChartBar` · `ChartBarBig` · `ChartBarDecreasing` · `ChartBarIncreasing` · `ChartBarStacked` · `ChartCandlestick` · `ChartColumnBig` · `ChartColumnDecreasing` · `ChartColumnIncreasing` · `ChartColumnStacked` · `ChartGantt` · `ChartNetwork` · `ChartNoAxesColumn` · `ChartNoAxesColumnDecreasing` · `ChartNoAxesCombined` · `ChartNoAxesGantt` · `ChartScatter` · `ChartSpline` · `Check` · `CheckCheck` · `CheckLine` · `Cherry` · `ChessBishop` · `ChessKing` · `ChessKnight` · `ChessPawn` · `ChessQueen` · `ChessRook` · `ChevronDown` · `ChevronFirst` · `ChevronLast` · `ChevronLeft` · `ChevronRight` · `ChevronUp` · `ChevronsDown` · `ChevronsDownUp` · `ChevronsLeft` · `ChevronsLeftRight` · `ChevronsLeftRightEllipsis` · `ChevronsRight` · `ChevronsRightLeft` · `ChevronsUp` · `ChevronsUpDown` · `Cigarette` · `CigaretteOff` · `Circle` · `CircleArrowDown` · `CircleArrowLeft` · `CircleArrowOutDownLeft` · `CircleArrowOutDownRight` · `CircleArrowOutUpLeft` · `CircleArrowOutUpRight` · `CircleArrowRight` · `CircleArrowUp` · `CircleCheckBig` · `CircleChevronDown` · `CircleChevronLeft` · `CircleChevronRight` · `CircleChevronUp` · `CircleDashed` · `CircleDashedCheck` · `CircleDivide` · `CircleDollarSign` · `CircleDotDashed` · `CircleEllipsis` · `CircleEqual` · `CircleEuro` · `CircleFadingArrowUp` · `CircleFadingPlus` · `CircleGauge` · `CircleMinus` · `CircleOff` · `CircleParkingOff` · `CirclePercent` · `CirclePile` · `CirclePlay` · `CirclePlus` · `CirclePoundSterling` · `CirclePower` · `CircleQuestionMark` · `CircleSlash` · `CircleSlash2` · `CircleSmall` · `CircleStar` · `CircleStop` · `CircleUser` · `CircleUserRound` · `Citrus` · `ClefAlto` · `ClefBass` · `ClefTreble` · `ClipboardClock` · `ClipboardCopy` · `ClipboardMinus` · `ClipboardPaste` · `ClipboardPen` · `ClipboardPenLine` · `ClipboardPlus` · `ClipboardType` · `ClipboardX` · `Clock1` · `Clock10` · `Clock11` · `Clock12` · `Clock2` · `Clock3` · `Clock4` · `Clock5` · `Clock6` · `Clock7` · `Clock8` · `Clock9` · `ClockAlert` · `ClockArrowDown` · `ClockArrowLeft` · `ClockArrowRight` · `ClockArrowUp` · `ClockCheck` · `ClockFading` · `ClockPlus` · `ClosedCaption` · `CloudAlert` · `CloudBackup` · `CloudCheck` · `CloudCog` · `CloudDrizzle` · `CloudFog` · `CloudHail` · `CloudMoon` · `CloudMoonRain` · `CloudOff` · `CloudRainWind` · `CloudSunRain` · `CloudSync` · `Cloudy` · `Club` · `Columns2` · `Columns3` · `Columns3Cog` · `Columns4` · `Combine` · `Command` · `Component` · `Computer` · `ConciergeBell` · `Cone` · `ContactRound` · `Contrast` · `Copy` · `CopyCheck` · `CopyMinus` · `CopyPlus` · `CopySlash` · `CopyX` · `Copyleft` · `Copyright` · `CornerDownLeft` · `CornerDownRight` · `CornerLeftDown` · `CornerLeftUp` · `CornerRightDown` · `CornerRightUp` · `CornerUpLeft` · `CornerUpRight` · `CreativeCommons` · `CreditCardCheck` · `CreditCardMinus` · `CreditCardPlus` · `CreditCardReader` · `CreditCardX` · `Crop` · `Crosshair` · `Crown` · `Cuboid` · `Cupcake` · `Currency` · `Cylinder` · `Dam` · `DatabaseArrowDown` · `DatabaseArrowUp` · `DatabaseBackup` · `DatabaseCheck` · `DatabaseMinus` · `DatabasePlus` · `DatabaseSearch` · `DatabaseX` · `DatabaseZap` · `DecimalsArrowLeft` · `DecimalsArrowRight` · `Delete` · `Dessert` · `Diameter` · `Diamond` · `DiamondMinus` · `DiamondPercent` · `DiamondPlus` · `Dice1` · `Dice2` · `Dice3` · `Dice4` · `Dice6` · `Dices` · `Diff` · `Disc` · `Disc2` · `Disc3` · `DiscAlbum` · `Divide` · `DnaOff` · `Dock` · `Dome` · `Donut` · `DoorClosedCog` · `DoorClosedLocked` · `DoorClosedPackage` · `Dot` · `Download` · `DraftingCompass` · `Drone` · `DropletOff` · `Drum` · `Drumstick` · `EarOff` · `EarthLock` · `Eclipse` · `EggFried` · `EggOff` · `Eject` · `Ellipse` · `Ellipsis` · `EllipsisVertical` · `Engine` · `Equal` · `EqualApproximately` · `EqualApproximatelyNot` · `EqualNot` · `Eraser` · `Euro` · `Expand` · `ExternalLink` · `EyeClosed` · `EyeDashed` · `EyeOff` · `FaceAngry` · `FaceExpressionless` · `FaceGrinning` · `FaceNeutral` · `FaceSlightlyFrowning` · `FaceSlightlySmiling` · `FaceSlightlySmilingPlus` · `FastForward` · `Faucet` · `Feather` · `FerrisWheel` · `FileArchive` · `FileAxis3d` · `FileBadge` · `FileBox` · `FileBraces` · `FileBracesCorner` · `FileChartColumn` · `FileChartColumnIncreasing` · `FileChartLine` · `FileChartPie` · `FileCheckCorner` · `FileClock` · `FileCodeCorner` · `FileCog` · `FileDiff` · `FileDigit` · `FileDown` · `FileExclamationPoint` · `FileHeadphone` · `FileHeart` · `FileInput` · `FileKey` · `FileMinus` · `FileMinusCorner` · `FileMusic` · `FileOutput` · `FilePen` · `FilePenLine` · `FilePlay` · `FilePlus` · `FilePlusCorner` · `FileQuestionMark` · `FileScan` · `FileSearch` · `FileSearchCorner` · `FileSignal` · `FileSliders` · `FileStack` · `FileSymlink` · `FileTerminal` · `FileType` · `FileTypeCorner` · `FileUp` · `FileUser` · `FileVideoCamera` · `FileVolume` · `FileX` · `FileXCorner` · `FingerprintPattern` · `FishOff` · `FishSymbol` · `FishingHook` · `FishingRod` · `FlagOff` · `FlagTriangleLeft` · `FlagTriangleRight` · `Flashlight` · `FlashlightOff` · `FlaskConicalOff` · `FlaskRound` · `Focus` · `FoldHorizontal` · `FoldVertical` · `FolderArchive` · `FolderBookmark` · `FolderCheck` · `FolderClock` · `FolderClosed` · `FolderCode` · `FolderCog` · `FolderDot` · `FolderDown` · `FolderGit` · `FolderGit2` · `FolderHeart` · `FolderInput` · `FolderKey` · `FolderLock` · `FolderMinus` · `FolderOpenDot` · `FolderOutput` · `FolderPen` · `FolderPlus` · `FolderRoot` · `FolderSearch` · `FolderSearch2` · `FolderSymlink` · `FolderSync` · `FolderTree` · `FolderUp` · `FolderX` · `Folders` · `Form` · `Forward` · `Frame` · `Fullscreen` · `Funnel` · `FunnelPlus` · `FunnelX` · `Galaxy` · `GalleryHorizontal` · `GalleryHorizontalEnd` · `GalleryThumbnails` · `GalleryVertical` · `GalleryVerticalEnd` · `Gamepad` · `GamepadDirectional` · `GapHorizontal` · `GapVertical` · `Gavel` · `GeorgianLari` · `Germ` · `GermOff` · `Ghost` · `GitBranchMinus` · `GitBranchPlus` · `GitCommitHorizontal` · `GitCommitVertical` · `GitCompare` · `GitCompareArrows` · `GitFork` · `GitGraph` · `GitMergeConflict` · `GitPullRequestArrow` · `GitPullRequestClosed` · `GitPullRequestCreate` · `GitPullRequestCreateArrow` · `GitPullRequestDraft` · `Glasses` · `GlobeCheck` · `GlobeCode` · `GlobeLock` · `GlobeOff` · `GlobeX` · `Gpu` · `Grape` · `Grid2x2` · `Grid2x2Check` · `Grid2x2Plus` · `Grid2x2X` · `Grid3x2` · `Grip` · `GripHorizontal` · `GripVertical` · `Group` · `Ham` · `Hamburger` · `Hand` · `HandFist` · `HandGrab` · `HandMetal` · `HandPlatter` · `Handbag` · `HardDriveUpload` · `HatGlasses` · `Haze` · `Hd` · `HdmiPort` · `Heading` · `Heading1` · `Heading2` · `Heading3` · `Heading4` · `Heading5` · `Heading6` · `HeadphoneOff` · `Headset` · `HeartCrack` · `HeartHandshake` · `HeartMinus` · `HeartOff` · `HeartPlus` · `HeartX` · `Helicopter` · `Hexagon` · `Highlighter` · `Hop` · `HopOff` · `HourglassCog` · `HouseCog` · `HouseHeart` · `HousePlug` · `HousePlus` · `HouseWifi` · `Houses` · `IceCreamBowl` · `IdCard` · `IdCardLanyard` · `ImageDown` · `ImageMinus` · `ImageOff` · `ImagePlay` · `ImagePlus` · `ImageUp` · `ImageUpscale` · `Images` · `Import` · `IndianRupee` · `Infinity` · `InspectionPanel` · `Italic` · `IterationCcw` · `IterationCw` · `IvBag` · `JapaneseYen` · `Joystick` · `Kayak` · `KazakhTenge` · `Key` · `Keyboard` · `KeyboardMusic` · `KeyboardOff` · `Lambda` · `LampFloor` · `LampWallDown` · `LampWallUp` · `LandPlot` · `LaptopMinimal` · `LaptopMinimalCheck` · `Lasso` · `LassoSelect` · `LayerArrowDown` · `LayerArrowUp` · `Layers2` · `LayersArrowDown` · `LayersArrowUp` · `LayersMinus` · `LayersPlus` · `LayoutArrowDown` · `LayoutArrowRight` · `LayoutFreeform` · `LayoutGrid` · `LayoutGridCircles` · `LayoutList` · `LayoutPanelLeft` · `LayoutPanelTop` · `LayoutTemplate` · `LeafyGreen` · `Lectern` · `LensConcave` · `LensConvex` · `Letters` · `Ligature` · `LightbulbOff` · `Lighthouse` · `LineDotBottomVertical` · `LineDotLeftHorizontal` · `LineDotRightHorizontal` · `LineDotTopVertical` · `LineSquiggle` · `LineStyle` · `Link2` · `Link2Off` · `List` · `ListCheck` · `ListChevronsDownUp` · `ListChevronsUpDown` · `ListClock` · `ListCollapse` · `ListEnd` · `ListFilter` · `ListFilterPlus` · `ListIndentDecrease` · `ListIndentIncrease` · `ListMinus` · `ListMusic` · `ListPlus` · `ListRestart` · `ListSortAscending` · `ListSortDescending` · `ListStart` · `ListTree` · `ListVideo` · `ListX` · `Loader` · `LoaderCircle` · `LoaderPinwheel` · `Locate` · `LocateFixed` · `LocateOff` · `LockKeyhole` · `LockKeyholeOpen` · `LockOpen` · `LogIn` · `LogOut` · `Logs` · `Lollipop` · `Luggage` · `Magnet` · `MailBadge` · `MailCheck` · `MailClock` · `MailMinus` · `MailPen` · `MailPlus` · `MailQuestionMark` · `MailSearch` · `MailWarning` · `MailX` · `Mailbox` · `Mails` · `MapMinus` · `MapPinCheck` · `MapPinCheckInside` · `MapPinHouse` · `MapPinMinus` · `MapPinMinusInside` · `MapPinOff` · `MapPinPen` · `MapPinPlus` · `MapPinPlusInside` · `MapPinSearch` · `MapPinX` · `MapPinXInside` · `MapPinned` · `MapPlus` · `Mars` · `MarsStroke` · `Maximize` · `Maximize2` · `MegaphoneOff` · `MemoryStick` · `Menu` · `Merge` · `MessageCircleCheck` · `MessageCircleCode` · `MessageCircleDashed` · `MessageCircleDashedCheck` · `MessageCircleHeart` · `MessageCircleMore` · `MessageCircleOff` · `MessageCirclePlus` · `MessageCircleQuestionMark` · `MessageCircleReply` · `MessageCircleWarning` · `MessageCircleX` · `MessageSquareCheck` · `MessageSquareCode` · `MessageSquareDashed` · `MessageSquareDiff` · `MessageSquareDot` · `MessageSquareHeart` · `MessageSquareLock` · `MessageSquareMore` · `MessageSquareOff` · `MessageSquarePlus` · `MessageSquareQuote` · `MessageSquareReply` · `MessageSquareShare` · `MessageSquareText` · `MessageSquareWarning` · `MessageSquareX` · `MessagesCircle` · `Metronome` · `MicAudioLines` · `MicOff` · `MicSignal` · `MicVocal` · `Microchip` · `MidiPort` · `MilkOff` · `Minimize` · `Minimize2` · `Minus` · `MirrorRectangular` · `MirrorRound` · `MonitorCheck` · `MonitorCloud` · `MonitorCog` · `MonitorDot` · `MonitorDown` · `MonitorOff` · `MonitorPause` · `MonitorPc` · `MonitorPlay` · `MonitorSmartphone` · `MonitorSpeaker` · `MonitorStop` · `MonitorUp` · `MonitorX` · `MoonStar` · `Mop` · `MopSparkles` · `Mosque` · `Mouse` · `MouseLeft` · `MouseOff` · `MousePointer` · `MousePointer2` · `MousePointer2Off` · `MousePointerBan` · `MousePointerClick` · `MouseRight` · `Mouth` · `MouthOff` · `Move` · `Move3d` · `MoveDiagonal` · `MoveDiagonal2` · `MoveDown` · `MoveDownLeft` · `MoveDownRight` · `MoveHorizontal` · `MoveLeft` · `MoveRight` · `MoveUp` · `MoveUpLeft` · `MoveUpRight` · `MoveVertical` · `Music2` · `Music3` · `Music4` · `Navigation2` · `Navigation2Off` · `NavigationOff` · `NepaliRupee` · `Nfc` · `NonBinary` · `NotebookDot` · `NotebookText` · `NotepadText` · `NotepadTextDashed` · `Nut` · `NutOff` · `Octagon` · `OctagonMinus` · `OctagonPause` · `OctagonX` · `Omega` · `Option` · `Orbit` · `Origami` · `Package2` · `PackageMinus` · `PackageOpen` · `PackagePlus` · `PackageSearch` · `PaintBucket` · `PaintbrushVertical` · `Panda` · `PanelBottom` · `PanelBottomClose` · `PanelBottomDashed` · `PanelBottomOpen` · `PanelLeft` · `PanelLeftClose` · `PanelLeftDashed` · `PanelLeftOpen` · `PanelLeftRightDashed` · `PanelRight` · `PanelRightClose` · `PanelRightDashed` · `PanelRightOpen` · `PanelTop` · `PanelTopBottomDashed` · `PanelTopClose` · `PanelTopDashed` · `PanelTopOpen` · `PanelsLeftBottom` · `PanelsRightBottom` · `PanelsTopLeft` · `PaperBag` · `Parasol` · `Parentheses` · `Park` · `ParkingMeter` · `Pause` · `PcCase` · `PenLine` · `PenOff` · `PenTool` · `PencilLine` · `PencilOff` · `PencilSparkles` · `Pentagon` · `Phi` · `PhilippinePeso` · `PhoneForwarded` · `PhoneIncoming` · `PhoneMissed` · `PhoneOff` · `PhoneOutgoing` · `Pi` · `PictureInPicture` · `PictureInPicture2` · `Pilcrow` · `PilcrowLeft` · `PilcrowRight` · `PillBottle` · `Pin` · `PinOff` · `PlaneLanding` · `PlaneTakeoff` · `PlantPot` · `Play` · `PlayOff` · `PlayingCard` · `PlayingCards` · `PlayingCardsFan` · `Plus` · `PocketKnife` · `Podium` · `Pointer` · `PointerOff` · `Popcorn` · `Popsicle` · `PoundSterling` · `PowerOff` · `Printer3d` · `PrinterCheck` · `PrinterX` · `Proportions` · `Pyramid` · `Rabbit` · `Radar` · `Radical` · `RadioOff` · `RadioReceiver` · `RadioTower` · `Radius` · `Rat` · `Ratio` · `ReceiptCent` · `ReceiptEuro` · `ReceiptIndianRupee` · `ReceiptJapaneseYen` · `ReceiptPoundSterling` · `ReceiptRussianRuble` · `ReceiptSwissFranc` · `ReceiptTurkishLira` · `RectangleCircle` · `RectangleEllipsis` · `RectangleGoggles` · `RectangleHorizontal` · `RectangleVertical` · `Redo` · `Redo2` · `RedoDot` · `RefreshCcw` · `RefreshCcwDot` · `RefreshCw` · `RefreshCwOff` · `Regex` · `RemoveFormatting` · `Repeat1` · `Repeat2` · `RepeatOff` · `Replace` · `ReplaceAll` · `Reply` · `ReplyAll` · `Rewind` · `Ribbon` · `Road` · `RobotArm` · `RobotVacuum` · `RockingChair` · `RollerCoaster` · `Rose` · `Rotate3d` · `RotateCcw` · `RotateCcwClock` · `RotateCcwKey` · `RotateCcwSquare` · `RotateCw` · `RotateCwClock` · `RotateCwFadingClock` · `RotateCwSquare` · `RouteOff` · `Rows2` · `Rows3` · `Rows4` · `RugbyBall` · `RulerDimensionLine` · `RussianRuble` · `Satellite` · `SaudiRiyal` · `Save` · `SaveAll` · `SaveCheck` · `SaveOff` · `SavePen` · `SavePlus` · `Scale3d` · `Scaling` · `Scan` · `ScanBox` · `ScanEye` · `ScanHeart` · `ScanLine` · `ScanQrCode` · `ScanSearch` · `ScanSquare` · `ScanText` · `Scissors` · `ScissorsLineDashed` · `Scooter` · `ScreenShare` · `ScreenShareOff` · `Scroll` · `SearchAlert` · `SearchCheck` · `SearchCode` · `SearchSlash` · `SearchX` · `Section` · `SendHorizontal` · `SendToBack` · `SeparatorHorizontal` · `SeparatorVertical` · `ServerCog` · `ServerCrash` · `ServerOff` · `ServerPlus` · `Settings2` · `Shapes` · `Share` · `Sheet` · `Shell` · `Shield` · `ShieldBan` · `ShieldCog` · `ShieldCogCorner` · `ShieldEllipsis` · `ShieldHalf` · `ShieldKeyhole` · `ShieldLock` · `ShieldMinus` · `ShieldOff` · `ShieldPlus` · `ShieldQuestionMark` · `ShieldUser` · `ShieldX` · `ShipCargo` · `ShoppingCartMinus` · `ShoppingCartPlus` · `Shredder` · `Shrimp` · `ShrimpOff` · `Shrink` · `Shrub` · `Shuffle` · `Signal` · `SignalHigh` · `SignalLow` · `SignalMedium` · `SignalZero` · `Signpost` · `SignpostBig` · `SkipBack` · `SkipForward` · `Slash` · `Slice` · `SlidersHorizontal` · `SlidersVertical` · `SmartphoneCharging` · `SmartphoneNfc` · `Snail` · `SoapDispenserDroplet` · `Space` · `Spade` · `Sparkle` · `Speech` · `SpellCheck` · `SpellCheck2` · `Spline` · `SplinePointer` · `Split` · `Spool` · `SportShoe` · `Spotlight` · `Square` · `SquareActivity` · `SquareArrowDown` · `SquareArrowDownLeft` · `SquareArrowDownRight` · `SquareArrowLeft` · `SquareArrowOutDownLeft` · `SquareArrowOutDownRight` · `SquareArrowOutUpLeft` · `SquareArrowOutUpRight` · `SquareArrowRight` · `SquareArrowRightEnter` · `SquareArrowRightExit` · `SquareArrowUp` · `SquareArrowUpLeft` · `SquareArrowUpRight` · `SquareAsterisk` · `SquareBookmark` · `SquareBottomDashedScissors` · `SquareCenterlineDashedHorizontal` · `SquareCenterlineDashedVertical` · `SquareChartGantt` · `SquareCheckBig` · `SquareChevronDown` · `SquareChevronLeft` · `SquareChevronRight` · `SquareChevronUp` · `SquareCode` · `SquareDashedBottom` · `SquareDashedBottomCode` · `SquareDashedKanban` · `SquareDashedMousePointer` · `SquareDashedPlus` · `SquareDashedText` · `SquareDashedTopSolid` · `SquareDashedX` · `SquareDashedXCorner` · `SquareDimensions` · `SquareDivide` · `SquareDot` · `SquareEqual` · `SquareExclamationPoint` · `SquareFunction` · `SquareKanban` · `SquareLibrary` · `SquareM` · `SquareMenu` · `SquareMinus` · `SquareMousePointer` · `SquareOff` · `SquareParking` · `SquareParkingOff` · `SquarePause` · `SquarePen` · `SquarePercent` · `SquarePi` · `SquarePilcrow` · `SquarePlay` · `SquarePlus` · `SquarePower` · `SquareRadical` · `SquareRoundCorner` · `SquareScissors` · `SquareSigma` · `SquareSlash` · `SquareSparkles` · `SquareSplitHorizontal` · `SquareSplitVertical` · `SquareSquare` · `SquareStack` · `SquareStar` · `SquareStop` · `SquareTerminal` · `SquareText` · `SquareUser` · `SquareUserRound` · `SquareX` · `SquaresExclude` · `SquaresIntersect` · `SquaresSubtract` · `SquaresUnite` · `Squircle` · `SquircleDashed` · `Squirrel` · `StarCheck` · `StarHalf` · `StarMinus` · `StarOff` · `StarPlus` · `StarX` · `StepBack` · `StepForward` · `Sticker` · `StickyNoteCheck` · `StickyNoteMinus` · `StickyNoteOff` · `StickyNotePlus` · `StickyNoteX` · `StickyNotes` · `Stone` · `StretchHorizontal` · `StretchVertical` · `Strikethrough` · `Subscript` · `Summary` · `SunDim` · `SunMedium` · `SunMoon` · `SunSnow` · `Superscript` · `SwatchBook` · `SwissFranc` · `SwitchCamera` · `Sword` · `Swords` · `Table` · `Table2` · `TableCellsMerge` · `TableCellsSplit` · `TableColumnsSplit` · `TableOfContents` · `TableProperties` · `TableRowsSplit` · `Tablet` · `TabletSmartphone` · `Tablets` · `TagPlus` · `TagX` · `Tags` · `Tally1` · `Tally2` · `Tally3` · `Tally4` · `Tally5` · `Tangent` · `TestTube` · `TestTubeDiagonal` · `TestTubes` · `TextAlignCenter` · `TextAlignEnd` · `TextAlignJustify` · `TextAlignJustifyCenter` · `TextAlignJustifyEnd` · `TextAlignJustifyStart` · `TextAlignStart` · `TextCursor` · `TextCursorInput` · `TextInitial` · `TextQuote` · `TextSearch` · `TextWrap` · `Theater` · `ThermometerSnowflake` · `ThermometerSun` · `TicTacToe` · `TicketCheck` · `TicketMinus` · `TicketPercent` · `TicketPlus` · `TicketSlash` · `TicketX` · `Tickets` · `TicketsPlane` · `Timeline` · `TimerOff` · `TimerReset` · `ToggleLeft` · `Toothbrush` · `ToothbrushSparkles` · `Tornado` · `Torus` · `Touchpad` · `TouchpadOff` · `TowelRack` · `TowerControl` · `ToyBrick` · `Trailer` · `TrainFrontTunnel` · `TrainTrack` · `TramFront` · `Transgender` · `Trash` · `TrashOff` · `TreeDeciduous` · `TrendingUpDown` · `Triangle` · `TriangleDashed` · `TriangleRight` · `TrianglesCenterlineDashedHorizontal` · `TrianglesCenterlineDashedVertical` · `TubeLotion` · `TurkishLira` · `Turntable` · `Turtle` · `TvMinimal` · `TvMinimalPlay` · `Type` · `TypeOutline` · `UmbrellaOff` · `Underline` · `Undo` · `Undo2` · `UndoDot` · `UnfoldHorizontal` · `UnfoldVertical` · `Ungroup` · `University` · `Unlink` · `Unlink2` · `Unplug` · `Upload` · `Usb` · `UsbCPort` · `UserCheck` · `UserCog` · `UserGroup` · `UserKey` · `UserLock` · `UserMinus` · `UserPen` · `UserPlus` · `UserRound` · `UserRoundArrowLeft` · `UserRoundCog` · `UserRoundGroup` · `UserRoundKey` · `UserRoundMinus` · `UserRoundPen` · `UserRoundPlus` · `UserRoundSearch` · `UserRoundX` · `UserSearch` · `UserShield` · `UserStar` · `UserX` · `UsersRound` · `UtilityPole` · `Van` · `Variable` · `Vault` · `VectorPolygon` · `VectorSquare` · `Vegan` · `VenetianMask` · `Venus` · `VenusAndMars` · `Vibrate` · `VibrateOff` · `VideoOff` · `Videotape` · `View` · `Virus` · `VirusOff` · `Volume` · `Volume1` · `Volume2` · `VolumeOff` · `VolumeX` · `Vote` · `WalletCards` · `WalletMinimal` · `Wallpaper` · `Wand` · `WandSparkles` · `WashingMachine` · `Watch` · `WavesArrowDown` · `WavesArrowUp` · `WavesHorizontal` · `WavesVertical` · `Waypoints` · `WebcamOff` · `WebhookOff` · `Weight` · `WeightTilde` · `Wheat` · `WheatOff` · `Whistle` · `WholeWord` · `WifiCog` · `WifiHigh` · `WifiLow` · `WifiOff` · `WifiPen` · `WifiSync` · `WifiZero` · `WindArrowDown` · `WindArrowUp` · `WineOff` · `Worm` · `WrenchOff` · `X` · `XLineTop` · `ZapOff` · `ZodiacAquarius` · `ZodiacAries` · `ZodiacCancer` · `ZodiacCapricorn` · `ZodiacGemini` · `ZodiacLeo` · `ZodiacLibra` · `ZodiacOphiuchus` · `ZodiacPisces` · `ZodiacSagittarius` · `ZodiacScorpio` · `ZodiacTaurus` · `ZodiacVirgo` · `ZoomIn` · `ZoomOut`
