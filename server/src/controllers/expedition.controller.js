import prisma from '../config/prisma.js';

// Parses stations_visited from either an array or a comma-separated string
// (matching the keywords/parameters pattern used elsewhere in this app) —
// trimmed, empty entries dropped. Returns [] for anything else so a land
// expedition that never touches this field just gets an empty list.
function parseStationList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  return [];
}

// GET /api/expeditions?region=Arctic&pi=<user_id>&page=1&limit=20
export const listExpeditions = async (req, res) => {
  const { region, pi, page, limit } = req.query;

  try {
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      ...(region && { region }),
      ...(pi && { principalInvestigator: pi }),
    };

    const [expeditions, total] = await Promise.all([
      prisma.expedition.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { startDate: 'desc' },
        include: {
          pi: {
            select: { id: true, name: true, email: true, organization: true },
          },
          _count: {
            select: { contentItems: true },
          },
        },
      }),
      prisma.expedition.count({ where }),
    ]);

    res.json({
      expeditions,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/expeditions/:id
export const getExpeditionById = async (req, res) => {
  try {
    const expedition = await prisma.expedition.findUnique({
      where: { id: req.params.id },
      include: {
        pi: {
          select: { id: true, name: true, email: true, organization: true },
        },
        contentItems: {
          select: { id: true, title: true, type: true, status: true },
        },
      },
    });

    if (!expedition) {
      return res.status(404).json({ error: 'Expedition not found' });
    }

    res.json(expedition);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/expeditions
export const createExpedition = async (req, res) => {
  const {
    name,
    region,
    description,
    start_date,
    end_date,
    latitude,
    longitude,
    principal_investigator,
    client_request_id,
    ship_name,
    voyage_name,
    cruise_name,
    cruise_number,
    route_area,
    stations_visited,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    // Phase 4: a client request id makes retries safe when the original
    // create succeeded but its response was lost. Only return an existing
    // record when it belongs to the authenticated requester.
    if (client_request_id) {
      const existing = await prisma.expedition.findUnique({
        where: { clientRequestId: client_request_id },
        include: {
          pi: {
            select: { id: true, name: true, email: true, organization: true },
          },
        },
      });
      if (existing && existing.principalInvestigator === req.user.id) {
        return res.status(200).json(existing);
      }
    }

    const expedition = await prisma.expedition.create({
      data: {
        name: name.trim(),
        region,
        description,
        startDate: start_date ? new Date(start_date) : null,
        endDate: end_date ? new Date(end_date) : null,
        latitude,
        longitude,
        principalInvestigator: principal_investigator,
        clientRequestId: client_request_id || null,
        // Voyage/cruise fields (NPDC parity) — all optional, all null for
        // land expeditions where they don't apply.
        shipName: ship_name || null,
        voyageName: voyage_name || null,
        cruiseName: cruise_name || null,
        cruiseNumber: cruise_number || null,
        routeArea: route_area || null,
        stationsVisited: parseStationList(stations_visited),
      },
      include: {
        pi: {
          select: { id: true, name: true, email: true, organization: true },
        },
      },
    });

    res.status(201).json(expedition);
  } catch (err) {
    if (err.code === 'P2002' && client_request_id) {
      const existing = await prisma.expedition.findUnique({
        where: { clientRequestId: client_request_id },
        include: {
          pi: {
            select: { id: true, name: true, email: true, organization: true },
          },
        },
      });
      if (existing && existing.principalInvestigator === req.user.id) {
        return res.status(200).json(existing);
      }
    }
    if (err.code === 'P2003') {
      return res.status(400).json({ error: 'Invalid principal investigator ID' });
    }
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/expeditions/:id
export const updateExpedition = async (req, res) => {
  const {
    name,
    region,
    description,
    start_date,
    end_date,
    latitude,
    longitude,
    principal_investigator,
    expected_updated_at,
    client_request_id,
    ship_name,
    voyage_name,
    cruise_name,
    cruise_number,
    route_area,
    stations_visited,
  } = req.body;

  if (name !== undefined && (!name || !name.trim())) {
    return res.status(400).json({ error: 'Name cannot be empty' });
  }

  try {
    // Phase 8: a retry after a successful PATCH whose response was lost must
    // be idempotent. The expedition remembers only the most recent edit key;
    // a different later edit naturally supersedes it and can still conflict.
    if (client_request_id) {
      const existing = await prisma.expedition.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) return res.status(404).json({ error: 'Expedition not found' });
      if (existing.lastEditRequestId === client_request_id) return res.json(existing);
    }

    // Phase 7 — conflicting edits.
    //
    // An edit made in the field can sit in the offline queue for days. By the
    // time it syncs, a comms officer may have corrected the same expedition
    // on shore. Last-write-wins would silently destroy one of the two, which
    // is exactly the "nothing should silently disappear" case.
    //
    // So an edit may declare the version it was based on. If the server has
    // moved on, the write is refused with 409 and the current server record,
    // and the client surfaces it as a conflict for a human to resolve.
    // Requests without expected_updated_at keep the old behavior, so existing
    // callers (the review queue, admin edits) are unaffected.
    if (expected_updated_at) {
      const current = await prisma.expedition.findUnique({
        where: { id: req.params.id },
        select: { updatedAt: true },
      });

      if (!current) {
        return res.status(404).json({ error: 'Expedition not found' });
      }

      const expected = new Date(expected_updated_at).getTime();
      const actual = new Date(current.updatedAt).getTime();

      // Second-level tolerance: JSON round-tripping of timestamps loses
      // sub-millisecond precision on some clients, and a false conflict is
      // almost as damaging as a silent overwrite.
      if (Number.isFinite(expected) && Math.abs(actual - expected) > 1000) {
        const server = await prisma.expedition.findUnique({
          where: { id: req.params.id },
          include: {
            pi: {
              select: { id: true, name: true, email: true, organization: true },
            },
          },
        });
        return res.status(409).json({
          error: 'This expedition was changed on the server after your copy was saved',
          conflict: true,
          updatedAt: server.updatedAt,
          server,
        });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (region !== undefined) updateData.region = region;
    if (description !== undefined) updateData.description = description;
    if (start_date !== undefined) updateData.startDate = start_date ? new Date(start_date) : null;
    if (end_date !== undefined) updateData.endDate = end_date ? new Date(end_date) : null;
    if (latitude !== undefined) updateData.latitude = latitude;
    if (longitude !== undefined) updateData.longitude = longitude;
    if (principal_investigator !== undefined) updateData.principalInvestigator = principal_investigator;
    if (ship_name !== undefined) updateData.shipName = ship_name || null;
    if (voyage_name !== undefined) updateData.voyageName = voyage_name || null;
    if (cruise_name !== undefined) updateData.cruiseName = cruise_name || null;
    if (cruise_number !== undefined) updateData.cruiseNumber = cruise_number || null;
    if (route_area !== undefined) updateData.routeArea = route_area || null;
    if (stations_visited !== undefined) updateData.stationsVisited = parseStationList(stations_visited);
    if (client_request_id) updateData.lastEditRequestId = client_request_id;

    const expedition = await prisma.expedition.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        pi: {
          select: { id: true, name: true, email: true, organization: true },
        },
      },
    });

    res.json(expedition);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Expedition not found' });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({ error: 'Invalid principal investigator ID' });
    }
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/expeditions/:id — admin only (see expedition.routes.js). This
// intentionally removes the complete database record for the expedition:
// content items, AI generations/social posts tied to those items,
// content-tag joins, and finally the expedition. Chosen deliberately over
// the earlier "block delete if content exists" guard: admin-only scope
// plus the confirmation dialog on the client are the safety net here, and
// archivists need to be able to retire a whole expedition in one step
// rather than needing to remove every linked record by hand first.
export const deleteExpedition = async (req, res) => {
  try {
    const expedition = await prisma.expedition.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true },
    });

    if (!expedition) {
      return res.status(404).json({ error: 'Expedition not found' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Alerts (Emergency Alert feature) reference this expedition with a
      // RESTRICT foreign key — friend #1's original cascade-delete never
      // had this table at all, so it has to be cleaned up explicitly here
      // or the expedition.delete() below fails with a constraint violation.
      await tx.alert.deleteMany({ where: { expeditionId: req.params.id } });

      const contentRows = await tx.contentItem.findMany({
        where: { expeditionId: req.params.id },
        select: { id: true },
      });
      const contentIds = contentRows.map((row) => row.id);

      let generationIds = [];
      if (contentIds.length) {
        const generations = await tx.aiGeneration.findMany({
          where: { contentItemId: { in: contentIds } },
          select: { id: true },
        });
        generationIds = generations.map((row) => row.id);

        if (generationIds.length) {
          await tx.socialPost.deleteMany({ where: { aiGenerationId: { in: generationIds } } });
          await tx.aiGeneration.deleteMany({ where: { id: { in: generationIds } } });
        }

        await tx.contentTag.deleteMany({ where: { contentItemId: { in: contentIds } } });
        await tx.contentItem.deleteMany({ where: { id: { in: contentIds } } });
      }

      await tx.expedition.delete({ where: { id: req.params.id } });
      return { deletedContentItems: contentIds.length, deletedAiGenerations: generationIds.length };
    });

    res.json({
      message: 'Expedition and all linked portal data deleted successfully',
      expeditionId: expedition.id,
      expeditionName: expedition.name,
      ...result,
    });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Expedition not found' });
    }
    res.status(500).json({ error: err.message });
  }
};
