import prisma from '../config/prisma.js';

const DANGER_TYPES = ['medical', 'weather', 'terrain_ice', 'equipment_vehicle', 'other'];

// Phase 3 — a new alert always bumps the level up exactly one step,
// capped at 'critical'. An unrecognized/missing current level is treated
// as 'low' rather than throwing, so this never blocks an alert from saving.
const DANGER_LEVELS = ['low', 'moderate', 'high', 'critical'];
function escalate(currentLevel) {
  const idx = DANGER_LEVELS.indexOf(currentLevel);
  const nextIdx = idx === -1 ? 1 : Math.min(idx + 1, DANGER_LEVELS.length - 1);
  return DANGER_LEVELS[nextIdx];
}

// Phase 5 — resolving an alert steps the level down exactly one notch,
// mirroring escalate(). Floors at 'low' rather than going negative.
function deEscalate(currentLevel) {
  const idx = DANGER_LEVELS.indexOf(currentLevel);
  const prevIdx = idx === -1 ? 0 : Math.max(idx - 1, 0);
  return DANGER_LEVELS[prevIdx];
}

// POST /api/expeditions/:id/alerts
// Phase 1 — record a danger report against an expedition/location.
// Phase 3 — the same request also escalates the expedition's danger level
// up exactly one step. Both writes happen in one transaction: a client
// should never see an alert saved without the level moving, or vice versa.
export const createAlert = async (req, res) => {
  const { id: expeditionId } = req.params;
  const { type, message, latitude, longitude, client_request_id } = req.body;

  if (!type || !DANGER_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${DANGER_TYPES.join(', ')}` });
  }

  try {
    const expedition = await prisma.expedition.findUnique({ where: { id: expeditionId } });
    if (!expedition) {
      return res.status(404).json({ error: 'Expedition not found' });
    }

    // A weak field connection can make the client retry a report whose
    // response never arrived. client_request_id keeps that retry from
    // creating a second alert — and, just as importantly, from escalating
    // the danger level a second time for what is really the same report.
    if (client_request_id) {
      const existing = await prisma.alert.findUnique({ where: { clientRequestId: client_request_id } });
      if (existing) return res.status(200).json(existing);
    }

    const nextLevel = escalate(expedition.dangerLevel);

    const [alert] = await prisma.$transaction([
      prisma.alert.create({
        data: {
          expeditionId,
          type,
          message: message?.trim() || null,
          reportedBy: req.user?.id || null,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          clientRequestId: client_request_id || null,
        },
        include: {
          reporter: { select: { id: true, name: true, role: true } },
        },
      }),
      prisma.expedition.update({
        where: { id: expeditionId },
        data: { dangerLevel: nextLevel },
      }),
    ]);

    res.status(201).json({ ...alert, expedition: { id: expeditionId, dangerLevel: nextLevel } });
  } catch (err) {
    if (err.code === 'P2002' && client_request_id) {
      const existing = await prisma.alert.findUnique({ where: { clientRequestId: client_request_id } });
      if (existing) return res.status(200).json(existing);
    }
    res.status(500).json({ error: err.message });
  }
};

// GET /api/alerts?since=<ISO timestamp>
// Phase 2 — polled by every signed-in client so a new report anywhere shows
// up as a prominent notification without needing a WebSocket/push service
// (kept deliberately simple to run cleanly on Vercel's serverless functions).
// Returns alerts created after `since`, across every expedition.
export const listRecentAlerts = async (req, res) => {
  const { since } = req.query;

  // Without `since` this would return the entire alert history on every
  // poll, so default to a narrow window (last 5 minutes) instead of
  // unbounded — a client that always sends its own `since` never hits this.
  const sinceDate = since ? new Date(since) : new Date(Date.now() - 5 * 60 * 1000);
  if (Number.isNaN(sinceDate.getTime())) {
    return res.status(400).json({ error: 'since must be a valid ISO timestamp' });
  }

  try {
    const alerts = await prisma.alert.findMany({
      where: { createdAt: { gt: sinceDate } },
      orderBy: { createdAt: 'asc' },
      include: {
        expedition: { select: { id: true, name: true, dangerLevel: true } },
        reporter: { select: { id: true, name: true, role: true } },
      },
    });

    res.json({ alerts, checkedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/expeditions/:id/alerts/:alertId/resolve
// Phase 5 — the only way the danger level ever comes back down: an
// admin/comms_officer explicitly clears one alert. No automatic decay.
export const resolveAlert = async (req, res) => {
  const { id: expeditionId, alertId } = req.params;

  try {
    const alert = await prisma.alert.findUnique({ where: { id: alertId } });
    if (!alert || alert.expeditionId !== expeditionId) {
      return res.status(404).json({ error: 'Alert not found for this expedition' });
    }

    // Already resolved — return as-is rather than de-escalating a second
    // time for a click that arrived twice (e.g. a double-tap on a weak
    // connection, or a retried request).
    if (alert.resolved) {
      return res.status(200).json(alert);
    }

    const expedition = await prisma.expedition.findUnique({ where: { id: expeditionId } });
    const nextLevel = deEscalate(expedition.dangerLevel);

    const [resolved] = await prisma.$transaction([
      prisma.alert.update({
        where: { id: alertId },
        data: { resolved: true, resolvedBy: req.user?.id || null, resolvedAt: new Date() },
        include: {
          reporter: { select: { id: true, name: true, role: true } },
          resolver: { select: { id: true, name: true, role: true } },
        },
      }),
      prisma.expedition.update({
        where: { id: expeditionId },
        data: { dangerLevel: nextLevel },
      }),
    ]);

    res.json({ ...resolved, expedition: { id: expeditionId, dangerLevel: nextLevel } });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Alert not found' });
    }
    res.status(500).json({ error: err.message });
  }
};

// GET /api/expeditions/:id/alerts
export const listAlerts = async (req, res) => {
  const { id: expeditionId } = req.params;

  try {
    const alerts = await prisma.alert.findMany({
      where: { expeditionId },
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, name: true, role: true } },
        resolver: { select: { id: true, name: true, role: true } },
      },
    });

    res.json({ alerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
