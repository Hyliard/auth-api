const express = require('express');
const authRoutes = require('./routes/auth.routes');
const clientRoutes = require('./routes/client.routes');
const deviceRoutes = require('./routes/device.routes');
const userRoutes = require('./routes/user.routes');
const { notFoundHandler, errorHandler } = require('./middleware/error.middleware');

const app = express();

// Only change this to an explicit trusted proxy/network after configuring deployment.
app.set('trust proxy', false);
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/users', userRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
