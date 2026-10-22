import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.routes.js';
import contentRoutes from './routes/content.routes.js';
import aiRoutes from './routes/ai.routes.js';
import expeditionRoutes from './routes/expedition.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import alertsRoutes from './routes/alerts.routes.js';
import archiveRoutes from './routes/archive.routes.js';
import usersRoutes from './routes/users.routes.js';
import searchRoutes from './routes/search.routes.js';
import stationRoutes from './routes/stations.routes.js';
import studioRoutes from './routes/studio.routes.js';
import datasetMetadataRoutes from './routes/datasetMetadata.routes.js';
import keywordRoutes from './routes/keyword.routes.js';
import researchStationRoutes from './routes/station.routes.js';
import accountRoutes from './routes/account.routes.js';
import datasetAccessRoutes from './routes/datasetAccess.routes.js';
import activitiesRoutes from './routes/activities.routes.js';
import researcherRoutes from './routes/researcher.routes.js';
import communitiesRoutes from './routes/communities.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import messagesRoutes from './routes/messages.routes.js';
import datasetUploadRoutes from './routes/datasetUpload.routes.js';


dotenv.config();
BigInt.prototype.toJSON = function () {
  return this.toString();
};
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'NCPOR Portal API' }));

app.use('/api/auth', authRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/expeditions', expeditionRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/archive', archiveRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/explorer/stations', stationRoutes);
app.use('/api/studio', studioRoutes);
app.use('/api/dataset-metadata', datasetMetadataRoutes);
app.use('/api/keywords', keywordRoutes);
app.use('/api/stations', researchStationRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/dataset-access-requests', datasetAccessRoutes);
app.use('/api/activities', activitiesRoutes);
app.use('/api/researchers', researcherRoutes);
app.use('/api/communities', communitiesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/dataset-upload', datasetUploadRoutes);



const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(` NCPOR Portal API running on http://localhost:${PORT}`));
