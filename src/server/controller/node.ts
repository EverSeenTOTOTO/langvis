import { Express } from 'express';

export default async (app: Express) => {
  app.post('/api/node/create', (req, res) => {});

  app.post('/api/node/delete', (req, res) => {});

  app.post('/api/node/update', (req, res) => {});

  app.get('/api/node/get', (req, res) => {});
};
