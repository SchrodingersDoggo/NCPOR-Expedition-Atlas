import prisma from '../config/prisma.js';

// GET /api/stations?region=Antarctic
// Public — this backs the region -> station -> coordinates picker on the
// dataset metadata form, and the "Browse by Location" facet on Archive.
// includeCounts=true adds how many published/archived datasets reference
// each station, matching NPDC's own "# Datasets" column.
export const listStations = async (req, res) => {
  try {
    const { region, includeCounts } = req.query;
    const stations = await prisma.station.findMany({
      where: region ? { region } : {},
      orderBy: [{ region: 'asc' }, { name: 'asc' }],
      ...(includeCounts === 'true' && {
        include: {
          _count: {
            select: {
              datasetMetadata: {
                where: { content: { status: { in: ['published', 'archived'] } } },
              },
            },
          },
        },
      }),
    });
    res.json(stations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/stations — admin/comms_officer only.
export const createStation = async (req, res) => {
  const { name, region, latitude, longitude, description } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (!region) return res.status(400).json({ error: 'region is required' });
  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'latitude and longitude are required' });
  }
  try {
    const station = await prisma.station.create({
      data: { name: String(name).trim(), region, latitude, longitude, description: description || null },
    });
    res.status(201).json(station);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A station with this name already exists in this region' });
    }
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/stations/:id — admin/comms_officer only.
export const updateStation = async (req, res) => {
  const { name, region, latitude, longitude, description } = req.body;
  try {
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (region !== undefined) data.region = region;
    if (latitude !== undefined) data.latitude = latitude;
    if (longitude !== undefined) data.longitude = longitude;
    if (description !== undefined) data.description = description || null;

    const station = await prisma.station.update({ where: { id: req.params.id }, data });
    res.json(station);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A station with this name already exists in this region' });
    }
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/stations/:id — admin/comms_officer only. Refuses when any
// DatasetMetadata still references it, same "don't silently detach real
// data" rule as deleteKeyword.
export const deleteStation = async (req, res) => {
  try {
    const usage = await prisma.datasetMetadata.count({ where: { stationId: req.params.id } });
    if (usage > 0) {
      return res.status(409).json({ error: `This station is used by ${usage} dataset record(s) and can't be deleted.` });
    }
    await prisma.station.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};
