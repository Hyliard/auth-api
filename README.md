# Auth API Local

API REST de autenticacion construida con Node.js + Express, PostgreSQL y Prisma.
Los usuarios, dispositivos y sesiones persisten en PostgreSQL.

## Requisitos

- Node.js >= 18 (usa `node --watch` para el modo dev)
- Docker con Docker Compose

## Instalacion y ejecucion

```bash
npm install
cp .env.example .env
# Completar JWT_SECRET con un secreto aleatorio propio antes de iniciar.
npx prisma migrate dev
npm run dev
```

o para produccion/simple:

```bash
npm install
cp .env.example .env
# Completar JWT_SECRET con un secreto aleatorio propio antes de iniciar.
npm start
```

El servidor queda escuchando en `http://localhost:3000`.

Variables de entorno (`.env`):

```
PORT=3000
JWT_SECRET=
JWT_EXPIRES_IN=7d
DATABASE_URL=postgresql://auth_user:auth_pass_dev@localhost:5432/auth_api?schema=public
```

`JWT_SECRET` queda vacio a proposito: el servidor no inicia hasta configurarlo.
Genera un valor aleatorio con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
y copialo en `.env`. Debe tener al menos 32 caracteres; se rechazan placeholders.
No compartas ese valor ni lo incluyas en Postman o en el repositorio.

Antes de escuchar conexiones se valida `DATABASE_URL` (URL PostgreSQL con host y base),
`JWT_SECRET`, `PORT` (entero de 1 a 65535, por defecto 3000 si se omite) y
`JWT_EXPIRES_IN` (entero positivo con unidad `ms`, `s`, `m`, `h`, `d`, `w` o `y`,
con duracion minima de un segundo; por defecto `7d` si se omite).
Valores vacios o invalidos hacen terminar el proceso con codigo 1 y un mensaje
que identifica el campo sin mostrar su valor. Esta validacion no comprueba conectividad a PostgreSQL.

## Estructura del proyecto

```
auth-api/
├── package.json
├── docker-compose.yml
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── .env.example
├── postman_collection.json
├── README.md
└── src/
    ├── app.js
    ├── server.js
    ├── routes/
    │   ├── auth.routes.js
    │   ├── device.routes.js
    │   └── user.routes.js
    ├── controllers/
    │   ├── auth.controller.js
    │   ├── device.controller.js
    │   └── user.controller.js
    ├── middleware/
    │   ├── auth.middleware.js
    │   └── error.middleware.js
    ├── store/
    │   ├── db.store.js
    │   └── prisma.js
    └── utils/
        ├── jwt.js
        ├── validators.js
        └── errors.js
```

## Como funciona la autenticacion

1. **Registro** (`POST /api/auth/register`): crea un usuario con la
   contrasena cifrada con `bcryptjs` (nunca en texto plano). El email se
   normaliza a minusculas y debe ser unico.
2. **Login** (`POST /api/auth/login`): valida credenciales, crea un
   **dispositivo** nuevo (`deviceId` unico) y una **sesion** nueva
   (`sessionId` unico) asociada a ese dispositivo y al usuario. El JWT
   devuelto lleva `userId`, `sessionId` y `deviceId` en su payload y tiene
   expiracion (`JWT_EXPIRES_IN`).
3. **Middleware de autenticacion** (`src/middleware/auth.middleware.js`):
   en cada request protegida, verifica la firma y expiracion del JWT, y
   ademas consulta la sesion en PostgreSQL: si la sesion fue revocada, o el
   dispositivo fue desvinculado, el token deja de ser valido aunque su
   firma siga siendo correcta. Esto es lo que permite una revocacion real
   (no solo basada en la expiracion del JWT).
4. **Cambio de contrasena**: al cambiarla, se revocan **todas** las
   sesiones del usuario (incluida la que se uso para hacer el cambio), asi
   que hace falta volver a iniciar sesion despues.
   Login y cambio de contrasena coordinan sus escrituras con un bloqueo de la fila
   del usuario dentro de transacciones PostgreSQL. El login vuelve a comprobar el
   hash bajo ese bloqueo; un login pendiente con credenciales anteriores devuelve
   `401` si el cambio ya se completo. Si el login escribe primero, su sesion queda
   incluida en la revocacion posterior. Hash y revocacion se confirman juntos.
5. **Desvincular dispositivo** (`DELETE /api/devices/:deviceId`): borra el
   dispositivo y revoca la(s) sesion(es) asociadas a el. Si el dispositivo
   desvinculado es el que uso la request actual, la respuesta lo indica
   (`currentSessionClosed: true`) y ese mismo token deja de funcionar en la
   siguiente llamada.
6. **Logout** (`DELETE /api/auth/session`): revoca unicamente la sesion
   actual (no afecta otros dispositivos vinculados).
7. **Eliminar cuenta** (`DELETE /api/users/me`): valida la contrasena,
   borra el usuario, todos sus dispositivos y revoca todas sus sesiones.

## Endpoints

| Metodo | Ruta | Auth | Descripcion |
|---|---|---|---|
| GET | /api/health | No | Estado de la API |
| POST | /api/auth/register | No | Crear usuario |
| POST | /api/auth/login | No | Iniciar sesion + registrar dispositivo |
| GET | /api/auth/me | Si | Usuario autenticado |
| POST | /api/auth/change-password | Si | Cambiar contrasena |
| DELETE | /api/auth/session | Si | Cerrar sesion actual |
| GET | /api/devices | Si | Listar dispositivos vinculados |
| DELETE | /api/devices/:deviceId | Si | Desvincular dispositivo |
| DELETE | /api/users/me | Si | Eliminar cuenta |
| POST | /api/clients | Si | Crear cliente |
| GET | /api/clients | Si | Listar clientes activos |
| GET | /api/clients/:clientId | Si | Obtener cliente |
| PATCH | /api/clients/:clientId | Si | Editar o reactivar cliente |
| DELETE | /api/clients/:clientId | Si | Archivar cliente |
| POST | /api/contracts | Si | Crear contrato |
| GET | /api/contracts | Si | Listar contratos activos y filtrar por cliente |
| GET | /api/contracts/:contractId | Si | Obtener contrato |
| PATCH | /api/contracts/:contractId | Si | Editar o reactivar contrato |
| DELETE | /api/contracts/:contractId | Si | Archivar contrato |

### Contracts

Los contratos siempre pertenecen al usuario autenticado y a uno de sus Clients
activos. Un Client archivado conserva sus Contracts existentes, pero no puede
recibir contratos nuevos. `DELETE /api/contracts/:contractId` es un soft delete;
`GET /api/contracts?includeInactive=true` incluye contratos archivados y
`GET /api/contracts?clientId=UUID` filtra por un Client propio.

Los importes se envian preferentemente como strings decimales y se devuelven como
strings para conservar precision. `currency` usa tres letras y se normaliza a
mayusculas. Las fechas opcionales usan `YYYY-MM-DD`, y `endDate` no puede ser
anterior a `startDate`. Las respuestas incluyen `client.id`, `client.name` y
`client.company`, pero no exponen `userId` ni incluyen WorkLogs.

## Ejemplos con curl

```bash
# Health check
curl http://localhost:3000/api/health

# Registro
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Luis Martinez","email":"luis@example.com","password":"Password123!"}'

# Login (guarda el token manualmente de la respuesta)
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"luis@example.com","password":"Password123!","deviceName":"Postman MacBook"}'

# Usuario autenticado
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer TOKEN"

# Cambiar contrasena
curl -X POST http://localhost:3000/api/auth/change-password \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"currentPassword":"Password123!","newPassword":"NewPassword456!"}'

# Listar dispositivos
curl http://localhost:3000/api/devices \
  -H "Authorization: Bearer TOKEN"

# Desvincular dispositivo
curl -X DELETE http://localhost:3000/api/devices/DEVICE_ID \
  -H "Authorization: Bearer TOKEN"

# Cerrar sesion actual
curl -X DELETE http://localhost:3000/api/auth/session \
  -H "Authorization: Bearer TOKEN"

# Eliminar cuenta
curl -X DELETE http://localhost:3000/api/users/me \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"password":"NewPassword456!"}'
```

## Coleccion de Postman

Importa `postman_collection.json` directamente en Postman.

Variables de la coleccion:

- `baseUrl` (por defecto `http://localhost:3000`)
- `token`, `deviceId`: se completan automaticamente con el script de test
  de la request **Login**
- `otherToken`, `otherDeviceId`: se completan con **Login - Segundo
  dispositivo**, para poder probar la desvinculacion de un dispositivo que
  no es el actual

### Secuencia de pruebas manual sugerida

1. **Health Check** -> `{ "status": "ok" }`
2. **Register** -> crea el usuario `luis@example.com`
3. **Login** -> guarda `token` y `deviceId` automaticamente
4. **Login - Segundo dispositivo** -> guarda `otherToken` y
   `otherDeviceId` (simula un segundo dispositivo del mismo usuario)
5. **Me** -> devuelve los datos del usuario autenticado
6. **List Devices** -> deberias ver 2 dispositivos, uno marcado como
   `isCurrentDevice: true`
7. **Unlink Other Device** -> desvincula el segundo dispositivo
8. **Me con token de dispositivo desvinculado** -> debe devolver **401**
9. **Change Password** -> cambia la contrasena y revoca todas las
   sesiones
10. **Me con token viejo tras cambiar password** -> debe devolver **401**
11. **Login con password nueva** -> vuelve a autenticar y guarda un nuevo
    `token`
12. **Logout (cerrar sesion actual)** -> revoca la sesion actual
13. **Me con token tras logout** -> debe devolver **401**
14. **Login para eliminar cuenta** -> autentica de nuevo
15. **Delete Account** -> elimina el usuario, sus dispositivos y sesiones
16. **Login tras eliminar cuenta** -> debe devolver **401** (el usuario ya
    no existe)

## Notas

- Los datos persisten en PostgreSQL aunque se reinicie el servidor.
- Las rutas inexistentes devuelven `404` en JSON gracias al middleware
  `notFoundHandler`.
- Los errores tienen el formato: `{ "error": { "message": "...",
  "statusCode": 400 } }`.

## Hardening Fase 1: entradas y limites

- Los cuerpos de registro, login, cambio de contrasena, eliminacion de cuenta y
  creacion/edicion de clientes deben ser objetos JSON. Tipos incorrectos, campos
  requeridos ausentes y JSON malformado devuelven `400`.
- `name` y `deviceName`: texto no vacio, hasta 200 caracteres despues de quitar
  espacios externos. `deviceName` sigue siendo opcional; si se envia, debe ser valido.
- Email: texto con formato valido y hasta 254 caracteres. Los emails de usuarios
  siguen normalizandose a minusculas.
- `password`, `currentPassword` y `newPassword`: minimo 8 caracteres, maximo
  **72 bytes UTF-8**, y no pueden ser solo espacios. No se recortan ni normalizan
  contrasenas. Una contrasena antigua que exceda ese limite ahora devuelve `400`.
- En clientes, `email` y `company` siguen siendo opcionales: omitidos, `null` o
  texto vacio se guardan como `null`. Los textos tienen un maximo de 254 caracteres;
  `active` debe ser booleano y los campos protegidos/desconocidos se rechazan.
- `clientId` y `deviceId` deben ser UUID con guiones. Un formato invalido devuelve
  `400`; un UUID valido inexistente o ajeno mantiene `404`. Claims UUID invalidos
  dentro de un JWT devuelven `401` antes de consultar Prisma.
- Un email duplicado devuelve `409`, incluso con registros simultaneos.
- Los errores del servidor se registran con metadatos seguros, sin cuerpos,
  credenciales, tokens, mensajes internos arbitrarios ni stack traces.

Los limites de autenticacion usan ventanas de **15 minutos**:

| Operacion | Limite | Clave |
|---|---|---|
| Registro | 10 solicitudes | IP |
| Login | 30 solicitudes | IP |
| Cambio de contrasena y eliminacion de cuenta | 10 solicitudes combinadas | Usuario autenticado |

Se cuentan solicitudes exitosas e invalidas que llegan al limitador. El exceso
devuelve `429` con el formato habitual de error, `Retry-After` y cabeceras `RateLimit`.
El cliente debe esperar el tiempo indicado antes de reintentar. No hay limite global
para consultas de clientes, dispositivos o `/api/auth/me`. IPv6 se agrupa por subred
con la configuracion predeterminada de la libreria.

Los contadores estan en memoria, son locales a cada proceso y se reinician al
reiniciar la API. Son apropiados para una instancia pequena; varias replicas
necesitarian compartir el almacenamiento del limitador.

`trust proxy` permanece en `false`: enviar `X-Forwarded-For` no permite cambiar la
IP usada por el limitador. Antes de desplegar detras de un reverse proxy, configura
solo sus IP/subredes de confianza y bloquea accesos directos que eviten el proxy.
No uses `trust proxy: true` indiscriminadamente. Sin ese ajuste, todos los clientes
del proxy compartirian su limite por IP.

## Pruebas de Fase 1

`npm test` ejecuta validaciones, logging seguro, rate limiting HTTP, traduccion
de errores y arranque del servidor sin necesitar PostgreSQL.

`TEST_DATABASE_URL='postgresql://USUARIO:CLAVE@HOST:PUERTO/auth_api_phase1_test' npm run test:integration`
ejecuta compatibilidad HTTP, aislamiento de usuarios, registros concurrentes,
concurrencia login/cambio de contrasena con bloqueo PostgreSQL real y rollback.
Prepara previamente una base **aislada** llamada `auth_api_phase1_test` con las
migraciones del proyecto y el cliente Prisma generado. Las pruebas no cargan `.env`,
rechazan otro nombre de base y eliminan solo los usuarios de prueba que crean.
No uses una base con datos reales. La coleccion Postman agrega casos de validacion
en una carpeta separada; no reemplaza estas pruebas automatizadas.

## Raspberry Pi Deployment

El deployment de Raspberry Pi vive en `/home/hyliard/docker/authdemo` y usa
`docker-compose.pi.yml`. La API se publica en `http://localhost:3004` mediante el
contenedor `authdemo-api`. PostgreSQL corre en `authdemo-db`, se publica solo en
`127.0.0.1:5433` y conserva sus datos en el volumen existente
`authdemo_authdemo_pgdata`.

La Raspberry necesita dos archivos locales que nunca deben entrar en Git:

- `.jwt_secret`: contiene exclusivamente el secreto JWT y debe tener permisos `600`.
- `.env.pi`: contiene `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` con los
  valores del deployment. Se crea a partir de `.env.pi.example` sin cambiar las
  credenciales existentes.

El comando estandar de deployment es:

```bash
cd /home/hyliard/docker/authdemo
./scripts/deploy-pi.sh
```

El script exige un working tree limpio, actualiza `main` mediante fast-forward,
construye `authdemo-api` (incluido `prisma generate`), ejecuta
`prisma migrate deploy` desde la imagen nueva, recrea solo la API y comprueba:

```bash
curl --fail http://127.0.0.1:3004/api/health
```

En produccion se usa exclusivamente `prisma migrate deploy`. No deben utilizarse
`prisma migrate dev` ni `prisma migrate reset`, y nunca debe eliminarse el volumen
PostgreSQL. La imagen actual basada en `node:20-bookworm-slim` genera correctamente
Prisma Client, pero Prisma muestra una advertencia no fatal al detectar OpenSSL;
instalar OpenSSL explicitamente en la imagen queda como mejora pendiente.
