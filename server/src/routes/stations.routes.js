import express from 'express';
import { getStations } from '../controllers/stations.controller.js';
const r = express.Router();
r.get('/', getStations);
export default r;
