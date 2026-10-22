import prisma from '../config/prisma.js';

const GEMINI_MODEL = 'gemini-3.6-flash';

// POST /api/ai/generate — generate AI draft(s) for a content item
// body: { content_item_id, source_text, types: ['web_summary','social_caption_twitter',...] }
export const generate = async (req, res) => {
  const { content_item_id, source_text, types } = req.body;

  try {
    const results = [];
    for (const type of types) {
      const prompt = buildPrompt(type, source_text);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 2048 },
          }),
        }
      );
      const data = await response.json();

      if (data.error) {
        throw new Error(`Gemini API error: ${data.error.message}`);
      }
      const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      const saved = await prisma.aiGeneration.create({
        data: {
          contentItemId: content_item_id,
          generationType: type,
          aiOutput: aiText,
          generatedByModel: GEMINI_MODEL,
        },
      });
      results.push(saved);
    }
    res.status(201).json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/ai/:id/edit — human edits the AI draft (input editing feature).
// comms_officer/admin can edit any generation. A researcher can only edit
// one that isn't tied to someone else's content — i.e. a generation made
// before the content item existed (content_item_id null, still mid-upload),
// or one attached to a content item they themselves uploaded.
export const editGeneration = async (req, res) => {
  const { edited_output } = req.body;
  try {
    if (req.user.role === 'researcher') {
      const existing = await prisma.aiGeneration.findUnique({
        where: { id: req.params.id },
        include: { content: true },
      });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const ownsIt = !existing.contentItemId || existing.content?.uploadedBy === req.user.id;
      if (!ownsIt) return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const result = await prisma.aiGeneration.update({
      where: { id: req.params.id },
      data: { editedOutput: edited_output, version: { increment: 1 }, reviewedBy: req.user.id },
    });
    res.json(result);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/ai/:id/publish — mark AI-generated (or edited) content as approved/live
export const publishGeneration = async (req, res) => {
  try {
    const result = await prisma.aiGeneration.update({
      where: { id: req.params.id },
      data: { isPublished: true },
    });
    res.json(result);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: err.message });
  }
};

function buildPrompt(type, sourceText) {
  const prompts = {
    web_summary: `Summarize the following expedition report into a 100-150 word website article suitable for public outreach. Keep it engaging but factual:\n\n${sourceText}`,
    social_caption_twitter: `Write a Twitter/X post (under 280 characters) announcing this expedition update. Include 2-3 relevant hashtags:\n\n${sourceText}`,
    social_caption_instagram: `Write an engaging Instagram caption (2-3 sentences) for this expedition update, in a warm and accessible tone for the general public. Include 5 relevant hashtags:\n\n${sourceText}`,
    alt_text: `Write a concise, descriptive alt-text (under 125 characters) for an image related to this content:\n\n${sourceText}`,
    hashtags: `Suggest 5 relevant hashtags for social media promotion of this content:\n\n${sourceText}`,
  };
  return prompts[type] || sourceText;
}
