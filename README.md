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
npx prisma migrate dev
npm run dev
```

o para produccion/simple:

```bash
npm install
cp .env.example .env
npm start
```

El servidor queda escuchando en `http://localhost:3000`.

Variables de entorno (`.env`):

```
PORT=3000
JWT_SECRET=cambia_este_secreto_por_una_cadena_larga_y_aleatoria
JWT_EXPIRES_IN=7d
DATABASE_URL=postgresql://auth_user:auth_pass_dev@localhost:5432/auth_api?schema=public
```

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
