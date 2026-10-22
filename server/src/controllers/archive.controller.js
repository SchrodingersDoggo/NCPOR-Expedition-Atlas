import prisma from '../config/prisma.js';

// ---------------------------------------------------------------------
// Shared constants / helpers
// ---------------------------------------------------------------------

const CONTENT_TYPES = ['report', 'dataset', 'publication', 'photo', 'video', 'activity'];
const REGIONS = ['Arctic', 'Antarctic', 'Himalaya', 'Southern_Ocean', 'Other'];
const RESEARCH_DOMAINS = [
  'climate_science',
  'glaciology',
  'oceanography',
  'atmospheric_science',
  'geology',
  'biology_ecology',
  'other',
];
const ALL_STATUSES = ['draft', 'in_review', 'published', 'archived'];
// Statuses that make an item part of the visible historical repository.
// Anything else (draft/in_review) is a submission still in the pipeline.
const VISIBLE_STATUSES = ['published', 'archived'];
const STAFF_ROLES = ['admin', 'comms_officer'];

const isStaff = (req) => !!req.user && STAFF_ROLES.includes(req.user.role);

// draft -> Pending, in_review -> Under Review, published -> Approved,
// archived -> Archived. Reuses the existing ContentStatus enum instead of
// adding a parallel one, so the Archive submission pipeline is always in
// sync with whatever content.controller.js / the Review Queue already do.
const ARCHIVE_STAGE_LABEL = {
  draft: 'Pending',
  in_review: 'Under Review',
  published: 'Approved',
  archived: 'Archived',
};

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function parseListParam(value, allowed) {
  if (!value) return undefined;
  const values = String(value)
    .split(',')
    .map((v) => v.trim())
    .filter((v) => allowed.includes(v));
  return values.length ? values : undefined;
}

// Same shape as parseListParam but with no fixed allowlist — Scientific
// Keywords are open-vocabulary (Tag rows created on demand), unlike
// region/type/research_domain which are fixed enums. Lowercased to match
// how tag names are always stored (see content.controller.js's
// keywordNames mapping).
function parseKeywordParam(value) {
  if (!value) return undefined;
  const values = String(value)
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  return values.length ? values : undefined;
}

const CONTENT_ITEM_INCLUDE = {
  expedition: { select: { id: true, name: true, region: true, description: true, startDate: true, endDate: true, latitude: true, longitude: true, shipName: true, voyageName: true, cruiseName: true, cruiseNumber: true, routeArea: true, stationsVisited: true, pi: { select: { id: true, name: true, organization: true } } } },
  tags: { include: { tag: true } },
  uploader: { select: { id: true, name: true, organization: true } },
  approver: { select: { id: true, name: true } },
  // Metadata-first dataset fields (NPDC parity). Present only when this
  // content item is one of a DatasetMetadata record's files — null for
  // reports/photos/videos/publications and for any dataset with no linked
  // metadata record. Reads the per-FILE role (raw/processed/documentation/
  // calibration/derived/other) rather than DatasetMetadata.processingLevel,
  // since one metadata record can now hold several files with different
  // roles — the role of THIS specific file is what's meaningful to badge
  // on THIS specific content item.
  datasetFileLink: { select: { role: true, label: true } },
};

function shapeItem(item) {
  if (!item) return item;
  const { datasetFileLink, ...rest } = item;
  const safe = rest.type === 'dataset'
    ? (() => {
        const { objectKey, wholeFileSha256, ...withoutPrivateStorageFields } = rest;
        return { ...withoutPrivateStorageFields, fileUrl: null };
      })()
    : rest;
  return {
    ...safe,
    archiveStage: ARCHIVE_STAGE_LABEL[item.status] || item.status,
    keywords: (item.tags || []).map((t) => t.tag.name),
    // Flattened from the DatasetFile relation so the client doesn't need
    // to know about that shape — null for every non-dataset type and for
    // datasets uploaded the old way with no linked metadata record.
    fileRole: datasetFileLink?.role || null,
    fileRoleLabel: datasetFileLink?.label || null,
  };
}

// ---------------------------------------------------------------------
// 1. Archive Search  —  GET /api/archive/search
// ---------------------------------------------------------------------
// Supports: q (title/keywords/expedition/author/dataset name), type,
// region, research_domain, expedition_id, year / year_from / year_to,
// status (staff only), sort, page, limit.
export const searchArchive = async (req, res) => {
  try {
    const { q, expedition_id, station_id, year, year_from, year_to, sort } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const type = parseListParam(req.query.type, CONTENT_TYPES);
    const region = parseListParam(req.query.region, REGIONS);
    const researchDomain = parseListParam(req.query.research_domain, RESEARCH_DOMAINS);
    const keyword = parseKeywordParam(req.query.keyword);
    let status = parseListParam(req.query.status, ALL_STATUSES);

    // Ordinary users (including unauthenticated visitors) only ever get
    // the published/archived repository — pending & in-review submissions
    // are not searchable outside Submission Tracking.
    if (!isStaff(req)) {
      status = VISIBLE_STATUSES;
    } else if (!status) {
      status = VISIBLE_STATUSES;
    }

    if (year !== undefined && year !== '' && Number.isNaN(parseInt(year, 10))) {
      return res.status(400).json({ error: 'year must be a number' });
    }
    if (year_from !== undefined && year_from !== '' && Number.isNaN(parseInt(year_from, 10))) {
      return res.status(400).json({ error: 'year_from must be a number' });
    }
    if (year_to !== undefined && year_to !== '' && Number.isNaN(parseInt(year_to, 10))) {
      return res.status(400).json({ error: 'year_to must be a number' });
    }

    const where = {
      status: { in: status },
      ...(type && { type: { in: type } }),
      ...(region && { region: { in: region } }),
      ...(researchDomain && { researchDomain: { in: researchDomain } }),
      ...(expedition_id && { expeditionId: expedition_id }),
      // "Browse by Location" drill-down: region -> station. Reaches
      // through the DatasetFile join to DatasetMetadata.stationId — only
      // dataset-type content items linked to a metadata record with this
      // station set will match, which is correct: station is a dataset
      // concept, not a property of reports/photos/videos directly.
      ...(station_id && { datasetFileLink: { datasetMetadata: { stationId: station_id } } }),
      // "Browse by Scientific Keywords" — matches items tagged with ANY of
      // the selected keywords (an item with 3 of 5 selected keywords still
      // matches), same OR-semantics as the other multi-select filters here.
      ...(keyword && { tags: { some: { tag: { name: { in: keyword } } } } }),
    };

    if (year) {
      where.year = parseInt(year, 10);
    } else if (year_from || year_to) {
      where.year = {
        ...(year_from && { gte: parseInt(year_from, 10) }),
        ...(year_to && { lte: parseInt(year_to, 10) }),
      };
    }

    if (q && q.trim()) {
      const term = q.trim();
      where.AND = [
        {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { summary: { contains: term, mode: 'insensitive' } },
            { authors: { contains: term, mode: 'insensitive' } },
            { source: { contains: term, mode: 'insensitive' } },
            { expedition: { name: { contains: term, mode: 'insensitive' } } },
            { tags: { some: { tag: { name: { contains: term, mode: 'insensitive' } } } } },
          ],
        },
      ];
    }

    const orderBy =
      sort === 'oldest'
        ? { createdAt: 'asc' }
        : sort === 'title'
          ? { title: 'asc' }
          : sort === 'year'
            ? { year: 'desc' }
            : { createdAt: 'desc' }; // 'newest' / default

    const [items, total] = await Promise.all([
      prisma.contentItem.findMany({
        where,
        include: CONTENT_ITEM_INCLUDE,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.contentItem.count({ where }),
    ]);

    res.json({
      items: items.map(shapeItem),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// 2. Year Timeline  —  GET /api/archive/timeline[?year=YYYY]
// ---------------------------------------------------------------------
export const getTimeline = async (req, res) => {
  try {
    const { year } = req.query;

    if (year) {
      const y = parseInt(year, 10);
      if (Number.isNaN(y)) return res.status(400).json({ error: 'year must be a number' });

      const where = { year: y, status: { in: VISIBLE_STATUSES } };
      const [byType, expeditionRows] = await Promise.all([
        prisma.contentItem.groupBy({ by: ['type'], where, _count: { _all: true } }),
        prisma.contentItem.findMany({
          where: { ...where, expeditionId: { not: null } },
          select: { expeditionId: true },
          distinct: ['expeditionId'],
        }),
      ]);

      const counts = Object.fromEntries(CONTENT_TYPES.map((t) => [t, 0]));
      byType.forEach((row) => {
        counts[row.type] = row._count._all;
      });

      return res.json({
        year: y,
        expeditions: expeditionRows.length,
        reports: counts.report,
        datasets: counts.dataset,
        publications: counts.publication,
        photos: counts.photo,
        videos: counts.video,
        activities: counts.activity,
        total: Object.values(counts).reduce((a, b) => a + b, 0),
      });
    }

    // No year given: return one row per year that has visible archive
    // material, oldest first, so the client can render the Year Timeline
    // without ever pulling the full item list.
    const rows = await prisma.contentItem.groupBy({
      by: ['year'],
      where: { year: { not: null }, status: { in: VISIBLE_STATUSES } },
      _count: { _all: true },
    });

    const years = rows
      .filter((r) => r.year != null)
      .map((r) => ({ year: r.year, total: r._count._all }))
      .sort((a, b) => a.year - b.year);

    res.json({ years });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// Facets  —  GET /api/archive/facets
// ---------------------------------------------------------------------
// Grounds the Advanced Filters panel's Expedition picker (and year bounds)
// in what's actually in the database, instead of a hard-coded list.
export const getFacets = async (req, res) => {
  try {
    const where = { status: { in: isStaff(req) ? ALL_STATUSES : VISIBLE_STATUSES } };

    const [yearAgg, expeditions, keywordTags, stations] = await Promise.all([
      prisma.contentItem.aggregate({
        where: { ...where, year: { not: null } },
        _min: { year: true },
        _max: { year: true },
      }),
      prisma.expedition.findMany({
        where: { contentItems: { some: where } },
        select: { id: true, name: true, region: true },
        orderBy: { name: 'asc' },
        take: 200,
      }),
      // Scientific Keywords in actual use — grounds "Browse by Scientific
      // Keywords" in real data instead of a fixed list, the same way the
      // Expedition picker above is grounded in real data rather than
      // hard-coded. Only approved terms (the controlled vocabulary) and
      // only tags attached to at least one visible item — a pending
      // suggestion never appears in this list until a comms_officer/admin
      // approves it via PATCH /api/keywords/:id/status.
      prisma.tag.findMany({
        where: { status: 'approved', items: { some: { content: where } } },
        select: { name: true },
        orderBy: { name: 'asc' },
        take: 300,
      }),
      // Region -> station -> coordinates (NPDC's "Browse by Location").
      prisma.station.findMany({
        orderBy: [{ region: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, region: true, latitude: true, longitude: true },
      }),
    ]);

    res.json({
      years: { min: yearAgg._min.year, max: yearAgg._max.year },
      regions: REGIONS,
      contentTypes: CONTENT_TYPES,
      researchDomains: RESEARCH_DOMAINS,
      expeditions,
      keywords: keywordTags.map((t) => t.name),
      stations,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// Related content scoring (used by getArchiveItem)
// ---------------------------------------------------------------------
async function findRelatedContent(item, limit = 12) {
  const tagIds = (item.tags || []).map((t) => t.tagId);
  const firstAuthor = item.authors ? item.authors.split(',')[0].trim() : null;

  const orConditions = [];
  if (item.expeditionId) orConditions.push({ expeditionId: item.expeditionId });
  if (item.year && item.region) orConditions.push({ year: item.year, region: item.region });
  if (item.researchDomain) orConditions.push({ researchDomain: item.researchDomain });
  if (tagIds.length) orConditions.push({ tags: { some: { tagId: { in: tagIds } } } });
  if (firstAuthor) orConditions.push({ authors: { contains: firstAuthor, mode: 'insensitive' } });

  if (!orConditions.length) return [];

  const candidates = await prisma.contentItem.findMany({
    where: {
      id: { not: item.id },
      status: { in: VISIBLE_STATUSES },
      OR: orConditions,
    },
    include: CONTENT_ITEM_INCLUDE,
    take: 100,
    orderBy: { createdAt: 'desc' },
  });

  const scored = candidates.map((c) => {
    let score = 0;
    if (item.expeditionId && c.expeditionId === item.expeditionId) score += 3;
    if (item.year && item.region && c.year === item.year && c.region === item.region) score += 2;
    if (item.researchDomain && c.researchDomain === item.researchDomain) score += 2;
    if (tagIds.length) {
      const shared = c.tags.filter((t) => tagIds.includes(t.tagId)).length;
      score += shared;
    }
    if (firstAuthor && c.authors && c.authors.toLowerCase().includes(firstAuthor.toLowerCase())) score += 1;
    return { item: c, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt)
    .slice(0, limit)
    .map((s) => shapeItem(s.item));
}

// ---------------------------------------------------------------------
// 3. Archive Item Detail  —  GET /api/archive/items/:id
// ---------------------------------------------------------------------
export const getArchiveItem = async (req, res) => {
  try {
    const item = await prisma.contentItem.findUnique({
      where: { id: req.params.id },
      include: CONTENT_ITEM_INCLUDE,
    });
    if (!item) return res.status(404).json({ error: 'Not found' });

    const owner = req.user && req.user.id === item.uploadedBy;
    if (!VISIBLE_STATUSES.includes(item.status) && !isStaff(req) && !owner) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (VISIBLE_STATUSES.includes(item.status)) {
      const updated = await prisma.contentItem.update({
        where: { id: item.id },
        data: { viewCount: { increment: 1 } },
      });
      item.viewCount = updated.viewCount;
    }

    const related = await findRelatedContent(item);
    const grouped = Object.fromEntries(CONTENT_TYPES.map((t) => [`${t}s`, []]));
    related.forEach((r) => {
      const key = `${r.type}s`;
      (grouped[key] || (grouped[key] = [])).push(r);
    });

    // Expedition Knowledge Hub: return every visible item attached to the
    // same expedition so the detail page can present the expedition as one
    // connected record (reports, datasets, publications and media).
    let expeditionContent = [];
    if (item.expeditionId) {
      const rows = await prisma.contentItem.findMany({
        where: { expeditionId: item.expeditionId, status: { in: VISIBLE_STATUSES } },
        include: CONTENT_ITEM_INCLUDE,
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      expeditionContent = rows.map(shapeItem);
    }

    res.json({ item: shapeItem(item), related, relatedByType: grouped, expeditionContent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// 5. Submission Tracking  —  GET /api/archive/submissions?bucket=pending|done
// ---------------------------------------------------------------------
export const listSubmissions = async (req, res) => {
  try {
    const { bucket } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const statusesForBucket =
      bucket === 'done' ? ['published', 'archived'] : bucket === 'all' ? ALL_STATUSES : ['draft', 'in_review'];

    const where = { status: { in: statusesForBucket } };
    // Researchers only get their own submissions tracked; staff see all.
    if (!isStaff(req)) where.uploadedBy = req.user.id;

    const [items, total, counts] = await Promise.all([
      prisma.contentItem.findMany({
        where,
        include: CONTENT_ITEM_INCLUDE,
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.contentItem.count({ where }),
      prisma.contentItem.groupBy({
        by: ['status'],
        where: isStaff(req) ? {} : { uploadedBy: req.user.id },
        _count: { _all: true },
      }),
    ]);

    const stageCounts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
    counts.forEach((c) => {
      stageCounts[c.status] = c._count._all;
    });

    res.json({
      items: items.map(shapeItem),
      stageCounts, // { draft, in_review, published, archived }
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// 6. Submission Queue  —  GET /api/archive/queue?sort=oldest
// ---------------------------------------------------------------------
const QUEUE_SORTS = {
  oldest: [{ createdAt: 'asc' }],
  newest: [{ createdAt: 'desc' }],
  priority: [{ priority: 'desc' }, { createdAt: 'asc' }],
  type: [{ type: 'asc' }, { createdAt: 'asc' }],
  status: [{ status: 'asc' }, { createdAt: 'asc' }],
};

export const getQueue = async (req, res) => {
  try {
    const sortKey = QUEUE_SORTS[req.query.sort] ? req.query.sort : 'oldest';
    const { page, limit, skip } = parsePagination(req.query);

    const where = { status: { in: ['draft', 'in_review'] } };
    const [items, total] = await Promise.all([
      prisma.contentItem.findMany({
        where,
        include: CONTENT_ITEM_INCLUDE,
        orderBy: QUEUE_SORTS[sortKey],
        skip,
        take: limit,
      }),
      prisma.contentItem.count({ where }),
    ]);

    const queue = items.map((item, i) => ({ position: skip + i + 1, ...shapeItem(item) }));

    res.json({
      queue,
      sort: sortKey,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ---------------------------------------------------------------------
// Submission status / priority updates (staff only, enforced in routes)
// ---------------------------------------------------------------------
export const updateSubmissionStatus = async (req, res) => {
  const { status } = req.body;
  if (!ALL_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${ALL_STATUSES.join(', ')}` });
  }
  try {
    const item = await prisma.contentItem.update({
      where: { id: req.params.id },
      data: {
        status,
        ...(['published', 'archived'].includes(status) && { approvedBy: req.user.id }),
      },
      include: CONTENT_ITEM_INCLUDE,
    });
    res.json(shapeItem(item));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};

export const updateSubmissionPriority = async (req, res) => {
  const priority = parseInt(req.body.priority, 10);
  if (Number.isNaN(priority) || priority < 0) {
    return res.status(400).json({ error: 'priority must be a non-negative integer' });
  }
  try {
    const item = await prisma.contentItem.update({
      where: { id: req.params.id },
      data: { priority },
    });
    res.json(shapeItem(item));
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};
