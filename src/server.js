require('dotenv').config();
const { validateConfig } = require('./utils/config');

let config;
try {
  config = validateConfig();
} catch (err) {
  // validateConfig only emits fixed messages containing field names, never values.
  console.error(err.message);
  process.exit(1);
}

const app = require('./app');
app.listen(config.port, () => {
  console.log(`API de autenticacion escuchando en http://localhost:${config.port}`);
  console.log('Los datos se almacenan en PostgreSQL.');
}).on('error', () => {
  console.error('No se pudo iniciar el servidor HTTP. Revisa el puerto y los permisos.');
  process.exit(1);
});
