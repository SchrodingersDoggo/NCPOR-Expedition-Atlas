import express from 'express';
import { Region } from '@prisma/client';
import prisma from '../config/prisma.js';
const router = express.Router();
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  try {
    const results = { researchers: [], expeditions: [], datasets: [], regions: [] };
    if (!q) return res.json({ success: true, results });
    const users = await prisma.user.findMany({ where: { role: 'researcher', OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] }, select: { id:true, name:true, email:true, organization:true }, take: 10 });
    results.researchers = users.map(u => ({ type: 'researcher', id: u.id, name: u.name, email: u.email, organization: u.organization }));
    const regionMatches = Object.values(Region).filter(v => v.toLowerCase().includes(q.toLowerCase()));
    const orExp = [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }];
    if (regionMatches.length) orExp.push({ region: { in: regionMatches } });
    const expeditions = await prisma.expedition.findMany({ where: { OR: orExp }, include: { pi: { select: { id:true, name:true } } }, take: 10 });
    results.expeditions = expeditions.map(e => ({ type: 'expedition', id: e.id, name: e.name, region: e.region, lat: e.latitude ? parseFloat(e.latitude) : null, lng: e.longitude ? parseFloat(e.longitude) : null, year: e.startDate ? new Date(e.startDate).getFullYear() : null, description: e.description, pi: e.pi ? e.pi.name : null }));
    const contentItems = await prisma.contentItem.findMany({ where: { status: 'published', OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] }, include: { expedition: { select: { name: true } } }, take: 10 });
    results.datasets = contentItems.map(c => ({ type: 'dataset', id: c.id, title: c.title, contentType: c.type, status: c.status, expeditionId: c.expeditionId || null, expeditionName: c.expedition ? c.expedition.name : null }));
    const regionNames = await prisma.expedition.findMany({
      where: { region: { in: regionMatches } },
      distinct: ['region'],
      select: { region: true },
      take: 10
    });

    // A region is a grouping/filter in Explorer, not a standalone destination.
    // Return every expedition belonging to the matched region so the client can
    // show the region's expedition list and let the user open any expedition.
    const regionExpeditions = regionMatches.length
      ? await prisma.expedition.findMany({
          where: { region: { in: regionMatches } },
          include: { pi: { select: { id: true, name: true } } },
          orderBy: { startDate: 'desc' }
        })
      : [];

    const regionExpeditionPayload = regionExpeditions.map(e => ({
      type: 'expedition',
      id: e.id,
      name: e.name,
      region: e.region,
      lat: e.latitude ? parseFloat(e.latitude) : null,
      lng: e.longitude ? parseFloat(e.longitude) : null,
      year: e.startDate ? new Date(e.startDate).getFullYear() : null,
      description: e.description,
      pi: e.pi ? e.pi.name : null
    }));

    results.regions = regionNames.map(r => ({
      type: 'region',
      region: r.region,
      expeditions: regionExpeditionPayload.filter(e => e.region === r.region)
    }));
    const filtered = {}; Object.entries(results).forEach(([k,v]) => { if (v.length) filtered[k] = v; });
    res.json({ success: true, results: filtered });
  } catch (err) { console.error('Search error:', err); res.status(500).json({ success: false, error: err.message || 'Search failed' }); }
});
export default router;
