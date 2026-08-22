const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API de autenticacion escuchando en http://localhost:${PORT}`);
  console.log('Los datos se almacenan en memoria y se perderan al reiniciar el servidor.');
});
