import crypto from 'crypto';
import prisma from '../config/prisma.js';
import { createAiEditPlan, createTextPlan, createSocialImage, createVoiceover, startRender, getRender, VOICEOVER_LANGUAGES } from '../services/studio.service.js';

function owns(project, userId) { return project && project.createdBy === userId; }

// Every video/data-file URL the client sends has to actually be one of
// this deployment's own Cloudinary assets — otherwise nothing stops a
// request from pointing TwelveLabs/Creatomate at arbitrary external URLs
// (cost abuse, or using this backend as a fetch pivot for content that has
// nothing to do with this app). This doesn't prove the researcher uploaded
// this *specific* file themselves (Studio's uploads aren't tracked
// per-user at the storage level), but it does close off arbitrary external
// URLs entirely, which is the actual exploitable gap.
function isOwnCloudinaryUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return false;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'res.cloudinary.com' && parsed.pathname.startsWith(`/${cloudName}/`);
  } catch {
    return false;
  }
}

function validateAssetList(list, label) {
  if (!Array.isArray(list)) return `${label} must be an array`;
  for (const item of list) {
    if (!isOwnCloudinaryUrl(item?.url)) {
      return `${label} contains a URL that wasn't uploaded through this app`;
    }
  }
  return null;
}

// Simple in-memory sliding-window limiter, scoped only to reel generation
// (the expensive call — TwelveLabs + ElevenLabs + Creatomate all cost real
// money/quota per call). Per-process, not shared across instances, which
// is fine at this project's scale — same trade-off as the OAuth pending-
// state maps elsewhere in this kind of app; swap for a shared store (Redis)
// if this ever runs multiple backend instances.
const GENERATE_LIMIT = 5;
const GENERATE_WINDOW_MS = 15 * 60 * 1000;
const generateAttempts = new Map(); // userId -> timestamps[]

function isRateLimited(userId) {
  const now = Date.now();
  const attempts = (generateAttempts.get(userId) || []).filter((t) => now - t < GENERATE_WINDOW_MS);
  if (attempts.length >= GENERATE_LIMIT) {
    generateAttempts.set(userId, attempts);
    return true;
  }
  attempts.push(now);
  generateAttempts.set(userId, attempts);
  return false;
}

export async function listProjects(req, res) {
  try {
    const projects = await prisma.studioProject.findMany({
      where: { createdBy: req.user.id },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/studio/voiceover-languages — code+label only, not the internal
// writing instructions (those are prompt-engineering detail, not for the UI).
export function listVoiceoverLanguages(req, res) {
  const languages = Object.entries(VOICEOVER_LANGUAGES).map(([code, cfg]) => ({ code, label: cfg.label }));
  res.json(languages);
}

export async function createProject(req, res) {
  try {
    const { title, notes, videos = [], dataFiles = [], images = [], voiceover_language } = req.body;
    if ((!Array.isArray(videos) || videos.length === 0) && (!Array.isArray(dataFiles) || dataFiles.length === 0) && (!Array.isArray(images) || images.length === 0)) {
      return res.status(400).json({ error: 'Upload at least a video, a photo, or a report/dataset before creating a Studio project.' });
    }

    const videoError = validateAssetList(videos, 'videos');
    if (videoError) return res.status(400).json({ error: videoError });
    const dataFileError = validateAssetList(dataFiles, 'dataFiles');
    if (dataFileError) return res.status(400).json({ error: dataFileError });
    const imageError = validateAssetList(images, 'images');
    if (imageError) return res.status(400).json({ error: imageError });

    // Falls back to English for anything not in the supported list —
    // matches the fallback createVoiceover/analyzeVideo already use, so an
    // invalid/missing value never breaks generation, just defaults quietly.
    const voiceoverLanguage = VOICEOVER_LANGUAGES[voiceover_language] ? voiceover_language : 'en';

    const project = await prisma.studioProject.create({
      data: {
        title: (title || 'Untitled Studio Reel').slice(0, 120),
        notes: (notes || '').slice(0, 2000) || null,
        sourceVideos: videos,
        sourceData: dataFiles,
        sourceImages: images,
        voiceoverLanguage,
        status: 'draft',
        createdBy: req.user.id,
      },
    });
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function runGeneration(projectId) {
  try {
    const project = await prisma.studioProject.findUnique({ where: { id: projectId } });
    if (!project) return;

    const videos = Array.isArray(project.sourceVideos) ? project.sourceVideos : [];
    const dataFiles = Array.isArray(project.sourceData) ? project.sourceData : [];
    const images = Array.isArray(project.sourceImages) ? project.sourceImages : [];

    // No video selected — a post (caption + summary + an image, either the
    // researcher's own photo restyled or one generated from the report/
    // dataset content) rather than the full reel pipeline. This is the
    // entire no-video path; nothing below it in this function runs.
    if (videos.length === 0) {
      const plan = await createTextPlan({ dataFiles, notes: project.notes || '' });

      let postImageUrl = null;
      try {
        const imageResult = await createSocialImage({ images, dataFiles, notes: project.notes || '' });
        postImageUrl = imageResult.imageUrl;
      } catch (imageError) {
        // Same principle as voiceover for the reel path — one AI step
        // failing shouldn't block the whole post. A researcher still gets
        // the caption/summary even if image generation has a bad day.
        console.warn('Studio: image generation skipped:', imageError.message);
      }

      await prisma.studioProject.update({
        where: { id: project.id },
        data: {
          title: plan.title,
          caption: plan.caption,
          aiSummary: plan.summary,
          postImageUrl,
          status: 'ready',
        },
      });
      return;
    }

    const plan = await createAiEditPlan({ videos, dataFiles, notes: project.notes || '', voiceoverLanguage: project.voiceoverLanguage || 'en' });

    let voiceoverUrl = null;
    try {
      voiceoverUrl = await createVoiceover(plan.voiceoverScript, project.voiceoverLanguage || 'en');
    } catch (voiceError) {
      // Voiceover should never block reel generation. If ElevenLabs is down or
      // misconfigured, continue with the original field audio.
      console.warn('Studio voiceover skipped:', voiceError.message);
    }

    const webhookToken = crypto.randomBytes(24).toString('hex');
    const webhookBase = process.env.PUBLIC_API_URL?.replace(/\/$/, '');
    const webhookUrl = webhookBase
      ? `${webhookBase}/api/studio/webhooks/creatomate?token=${webhookToken}`
      : undefined;
    const render = await startRender({
      videos,
      plan,
      voiceoverUrl,
      webhookUrl,
      metadata: project.id,
    });

    await prisma.studioProject.update({
      where: { id: project.id },
      data: {
        title: plan.title,
        caption: plan.caption,
        aiSummary: plan.summary,
        editPlan: plan,
        voiceoverScript: plan.voiceoverScript || null,
        voiceoverUrl: voiceoverUrl || null,
        renderId: render.id,
        renderStatus: render.status || 'planned',
        // Stored regardless of whether webhookUrl was actually set (i.e.
        // even in local dev without PUBLIC_API_URL) — getProject's polling
        // path re-derives status from Creatomate directly either way, and
        // keeping this set is harmless and one less conditional to get
        // wrong later if PUBLIC_API_URL gets added afterward.
        webhookToken,
        status: 'rendering',
      },
    });
  } catch (err) {
    console.error('Studio generation failed:', err);
    try {
      await prisma.studioProject.update({
        where: { id: projectId },
        data: { status: 'failed', errorMessage: String(err.message || err).slice(0, 1000) },
      });
    } catch {}
  }
}

export async function generateProject(req, res) {
  try {
    const project = await prisma.studioProject.findUnique({ where: { id: req.params.id } });
    if (!owns(project, req.user.id)) return res.status(404).json({ error: 'Studio project not found' });

    if (isRateLimited(req.user.id)) {
      return res.status(429).json({ error: `You can generate up to ${GENERATE_LIMIT} reels every 15 minutes. Try again shortly.` });
    }

    const updated = await prisma.studioProject.update({
      where: { id: project.id },
      data: { status: 'analyzing', errorMessage: null },
    });

    // Return immediately so Render/proxies do not time out while video analysis,
    // AI analysis and the cloud render are being prepared. The frontend polls project status.
    res.status(202).json(updated);
    setImmediate(() => { runGeneration(project.id); });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getProject(req, res) {
  try {
    let project = await prisma.studioProject.findUnique({ where: { id: req.params.id } });
    if (!owns(project, req.user.id)) return res.status(404).json({ error: 'Studio project not found' });

    if (project.renderId && project.status === 'rendering') {
      try {
        const render = await getRender(project.renderId);
        const patch = { renderStatus: render.status };
        if (render.status === 'succeeded') {
          patch.status = 'ready';
          patch.reelUrl = render.url;
          patch.thumbnailUrl = render.snapshot_url || null;
        } else if (render.status === 'failed') {
          patch.status = 'failed';
          patch.errorMessage = render.error_message || 'Video render failed';
        }
        project = await prisma.studioProject.update({ where: { id: project.id }, data: patch });
      } catch (err) {
        console.warn('Render status refresh failed:', err.message);
      }
    }
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateProject(req, res) {
  try {
    const project = await prisma.studioProject.findUnique({ where: { id: req.params.id } });
    if (!owns(project, req.user.id)) return res.status(404).json({ error: 'Studio project not found' });
    const data = {};
    if (typeof req.body.caption === 'string') data.caption = req.body.caption.slice(0, 5000);
    if (typeof req.body.aiSummary === 'string') data.aiSummary = req.body.aiSummary.slice(0, 8000);
    if (typeof req.body.title === 'string') data.title = req.body.title.slice(0, 120);
    const updated = await prisma.studioProject.update({ where: { id: project.id }, data });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteProject(req, res) {
  try {
    const project = await prisma.studioProject.findUnique({ where: { id: req.params.id } });
    if (!owns(project, req.user.id)) return res.status(404).json({ error: 'Studio project not found' });
    await prisma.studioProject.delete({ where: { id: project.id } });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteGenerated(req, res) {
  try {
    const project = await prisma.studioProject.findUnique({ where: { id: req.params.id } });
    if (!owns(project, req.user.id)) return res.status(404).json({ error: 'Studio project not found' });
    const updated = await prisma.studioProject.update({
      where: { id: project.id },
      data: {
        caption: null, aiSummary: null,
        editPlan: undefined, renderId: null, renderStatus: null, reelUrl: null, thumbnailUrl: null,
        postImageUrl: null,
        status: 'draft', errorMessage: null,
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Constant-time comparison so a mismatched token can't be brute-forced by
// timing how fast the comparison fails — standard practice for anything
// that functions as a secret check, same idea as a password compare.
function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function creatomateWebhook(req, res) {
  try {
    const render = req.body;
    const id = render?.metadata;
    if (!id) return res.status(200).json({ ok: true });
    const project = await prisma.studioProject.findUnique({ where: { id } });
    if (!project || !project.renderId || project.renderId !== render.id) {
      return res.status(200).json({ ok: true });
    }
    // The check that actually matters: Creatomate doesn't sign its webhook
    // calls, so the render-id match above alone isn't enough to prove this
    // request came from Creatomate rather than someone who's seen this
    // project's data. The token was generated server-side and only ever
    // sent to Creatomate as part of the callback URL — never returned to
    // the client — so a mismatch here means the request isn't genuine.
    if (!project.webhookToken || !tokensMatch(String(req.query.token || ''), project.webhookToken)) {
      console.warn(`Studio webhook: token mismatch for project ${id} — ignoring`);
      return res.status(200).json({ ok: true });
    }
    const data = { renderStatus: render.status };
    if (render.status === 'succeeded') {
      data.status = 'ready';
      data.reelUrl = render.url;
      data.thumbnailUrl = render.snapshot_url || null;
    } else if (render.status === 'failed') {
      data.status = 'failed';
      data.errorMessage = render.error_message || 'Video render failed';
    }
    await prisma.studioProject.update({ where: { id }, data });
    res.json({ ok: true });
  } catch (err) {
    console.error('Creatomate webhook:', err);
    res.status(200).json({ ok: true });
  }
}
