# Deploy VPS — Dev Environment

> **Stack:** API (Hono) + Web preview (Vite → Nginx) + Worker, via Docker Compose.  
> Nginx del host actúa como reverse proxy con SSL (Certbot).

---

> Checklist completo de subdominios requeridos (app, Supabase, RTC, Office) en
> [docs/deployment/dns-subdomains.md](deployment/dns-subdomains.md).

## Arquitectura

```
Internet
  → Nginx (host) :443
    → <SUBDOMINIO>/api/*  → Docker: runly-api :4010
    → <SUBDOMINIO>/       → Docker: runly-web-preview :5173
```

Runly ERP y Supabase corren en **VPS separados**. Postgres está expuesto en el VPS de Supabase
en el puerto `5432`, restringido por firewall a la IP del VPS de Runly:

```bash
# Ejecutado una vez en el VPS de Supabase (ya hecho)
ufw allow from <IP_VPS_RUNLY> to any port 5432
```

Esto elimina la necesidad de tunnels SSH. La `DATABASE_URL` apunta directamente al VPS de Supabase.

---

## Requisitos en el VPS de Runly

```bash
apt update && apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx git
```

---

## Paso 1 — Clonar el repositorio

```bash
cd /opt
git clone https://github.com/raulbellosom/runly-erp.git runlyerp-dev
cd runlyerp-dev
```

---

## Paso 2 — Crear el `.env`

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Valores a completar (obténlos del VPS de Supabase en `/path/to/supabase/docker/.env`):

```dotenv
NODE_ENV=production
RUNLY_APP_NAME="Runly ERP"
RUNLY_API_PORT=4010
RUNLY_TIME_ZONE=America/Mexico_City
TZ=America/Mexico_City

SUPABASE_URL=https://supabase.example.com
SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
SUPABASE_JWT_SECRET=<JWT_SECRET>

# Postgres expuesto directamente — sin tunnel SSH
DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@<IP_VPS_SUPABASE>:5432/postgres
DIRECT_URL=postgresql://postgres:<POSTGRES_PASSWORD>@<IP_VPS_SUPABASE>:5432/postgres

# JWT_SECRET debe ser el mismo valor que SUPABASE_JWT_SECRET
JWT_SECRET=<JWT_SECRET>
CORS_ORIGIN=https://<SUBDOMINIO>

VITE_SUPABASE_URL=https://supabase.example.com
VITE_SUPABASE_ANON_KEY=<ANON_KEY>
VITE_RUNLY_API_URL=https://<SUBDOMINIO>/api
```

> `VITE_RUNLY_API_URL` apunta al subdominio público — el browser del usuario final es quien
> llama a la API, no el servidor.

---

## Paso 3 — Build y levantado de contenedores

```bash
cd /opt/runlyerp-dev

# Primera vez: construye imágenes y arranca
docker compose up -d --build

# Verificar que los tres contenedores están Up
docker compose ps

# Verificar que la API responde
curl -s http://localhost:4010/health
```

---

## Paso 4 — Migraciones y seed (primera vez)

```bash
cd /opt/runlyerp-dev
npm install -g pnpm
pnpm install --frozen-lockfile

pnpm prisma:deploy
pnpm db:seed
```

---

## Paso 5 — Certificado SSL

```bash
# El DNS del subdominio debe apuntar a la IP del VPS de Runly antes de correr esto
certbot --nginx -d <SUBDOMINIO>
```

---

## Paso 6 — Nginx reverse proxy

Crea `/etc/nginx/sites-available/<SUBDOMINIO>.conf`:

```nginx
server {
    listen 80;
    server_name <SUBDOMINIO>;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name <SUBDOMINIO>;

    ssl_certificate     /etc/letsencrypt/live/<SUBDOMINIO>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<SUBDOMINIO>/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Content-Type-Options   nosniff;
    add_header X-Frame-Options          SAMEORIGIN;
    add_header Referrer-Policy          strict-origin-when-cross-origin;

    client_max_body_size 50M;

    location /api/ {
        proxy_pass         http://127.0.0.1:4010/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location / {
        proxy_pass         http://127.0.0.1:5173;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/<SUBDOMINIO>.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## Verificación

```bash
curl https://<SUBDOMINIO>/api/health
# {"ok":true,...}
```

Abre `https://<SUBDOMINIO>` en el browser.

---

## Actualizar el deploy (CD manual)

```bash
cd /opt/runlyerp-dev
git pull origin main
docker compose up -d --build

# Si hay nuevas migraciones
pnpm prisma:deploy
```

---

## Firewall del VPS de Runly

Solo deben estar abiertos hacia internet:

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw deny 4010
ufw deny 5173
ufw enable
```

---

## Agregar otro proyecto a Supabase

Para cada nuevo VPS que necesite conectarse a Postgres, agregar su IP en el VPS de Supabase:

```bash
ufw allow from <IP_NUEVO_VPS> to any port 5432
```

Nada más. No hay tunnels ni configuración adicional.

---

## Verificar variables dentro de Docker

```bash
# Secretos definidos (sin mostrar valor)
docker compose exec api sh -c '[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] && echo "OK" || echo "VACIO"'
docker compose exec api sh -c '[ -n "$JWT_SECRET" ] && echo "OK" || echo "VACIO"'
docker compose exec api sh -c '[ -n "$DATABASE_URL" ] && echo "OK" || echo "VACIO"'

# Variables Vite bakeadas en el frontend
docker compose exec web-preview grep -r "https://<SUBDOMINIO>" /usr/share/nginx/html --include="*.js" | head -c 200
```

Si las variables Vite no aparecen correctas, reconstruir el frontend:

```bash
docker compose build --no-cache web-preview
docker compose up -d web-preview
```
