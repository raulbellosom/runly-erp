---
title: Librerías disponibles
summary: Qué puedes importar en los componentes React de un módulo de Runly, con la versión exacta instalada.
order: 6
---
Estas son las librerías que un componente de `components/` puede importar. Las marcadas como *incluidas en la app* se resuelven en tiempo de ejecución y no pesan en tu módulo; las demás las empaqueta esbuild dentro del bundle del módulo.

| Librería | Versión | Disponibilidad | Qué importas |
|---|---|---|---|
| `react` | 19.3.0 | Incluida en la app (no pesa en tu módulo) | useState, useEffect, useMemo, useCallback, useRef, useContext, createContext, forwardRef, memo, Fragment |
| `react-dom` | 19.3.0 | Incluida en la app (no pesa en tu módulo) | createPortal, flushSync |
| `@runly/ui` | 0.1.0 | Incluida en la app (no pesa en tu módulo) | PageHeader, Card, Button, TextField, SelectField, DatePickerField, RunlyTable, DataTable, Dialog, Sheet, ConfirmDialog, EmptyState, ErrorState, Skeleton, Badge, Tabs, buildApiHeaders ... |
| `@runly/sdk` | 0.1.0 | Incluida en la app (no pesa en tu módulo) | createRunlyClient |
| `@runly/validators` | 0.1.0 | Incluida en la app (no pesa en tu módulo) | Esquemas Zod compartidos |
| `@tanstack/react-query` | 5.104.0 | Incluida en la app (no pesa en tu módulo) | useQuery, useMutation, useQueryClient |
| `react-router-dom` | 7.18.3 | Incluida en la app (no pesa en tu módulo) | useNavigate, useParams, useLocation, Link |
| `zustand` | 5.0.15 | Incluida en la app (no pesa en tu módulo) | create |
| `sonner` | 2.0.7 | Incluida en la app (no pesa en tu módulo) | toast |
| `lucide-react` | 1.48.0 | Incluida en la app (no pesa en tu módulo) | Iconos: Plus, Pencil, Trash2, Search, Calendar ... |
| `recharts` | 3.8.1 | Incluida en la app (no pesa en tu módulo) | ResponsiveContainer, BarChart, LineChart, PieChart, AreaChart, Tooltip, Legend |
| `react-hook-form` | 7.75.0 | Se empaqueta en tu módulo (agrega peso) | useForm, Controller (prefiere los campos de @runly/ui) |
| `motion` | 12.38.0 | Se empaqueta en tu módulo (agrega peso) | motion, AnimatePresence (~280 KB, usar con moderacion) |
| `tailwindcss` | 4.3.1 | Estilos | Clases utilitarias en className (sin importar nada) |

También puedes importar librerías del navegador desde `https://esm.sh/<paquete>`, pero prefiere las de la tabla. No hay APIs de Node (`fs`, `path`, `crypto`) en el navegador.

*Página generada por `scripts/generate-module-runtime-catalog.mjs` a partir de las versiones instaladas en Runly.*
