import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { toFile } from "openai";
import { db } from "./db";
import { contentItems, contentImages, qaMessages } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import {
  getVideoMetadata,
  downloadAndExtractFrames,
  getInstagramCaption,
} from "./utils/video";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  try {
    const file = await toFile(audioBuffer, "audio.wav");
    const response = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
    });
    return response.text;
  } catch (e) {
    console.error("Transcription failed:", e);
    return "";
  }
}

async function analyzeWithVision(
  frames: string[],
  transcript: string,
  caption: string,
): Promise<{ title: string; summary: string; keyTopics: string[]; insights: string }> {
  const imageMessages: any[] = frames.map((frame) => ({
    type: "image_url",
    image_url: { url: `data:image/jpeg;base64,${frame}`, detail: "low" },
  }));

  const textContext = [];
  if (transcript) textContext.push(`Transcript:\n${transcript}`);
  if (caption) textContext.push(`Caption:\n${caption}`);

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 4096,
    messages: [
      {
        role: "system",
        content: `You analyze social media content (videos, reels, carousel posts). Provide structured analysis in JSON format with these fields:
- "title": A concise descriptive title for this content
- "summary": A comprehensive 2-4 paragraph summary of what the content is about
- "keyTopics": An array of 3-8 key topics or themes covered
- "insights": Detailed insights, takeaways, or notable points from the content

Be thorough and informative. Extract as much useful information as possible.`,
      },
      {
        role: "user",
        content: [
          ...imageMessages,
          {
            type: "text",
            text: textContext.length > 0
              ? `Analyze this content:\n\n${textContext.join("\n\n")}`
              : "Analyze this visual content thoroughly.",
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title || "Untitled",
      summary: parsed.summary || "",
      keyTopics: parsed.keyTopics || [],
      insights: parsed.insights || "",
    };
  } catch {
    return { title: "Untitled", summary: raw, keyTopics: [], insights: "" };
  }
}

async function analyzeTextContent(
  metadata: { title: string; description: string; uploader: string; subtitles: string },
): Promise<{ title: string; summary: string; keyTopics: string[]; insights: string }> {
  const context = [
    `Title: ${metadata.title}`,
    `Uploader: ${metadata.uploader}`,
    metadata.description ? `Description:\n${metadata.description}` : "",
    metadata.subtitles ? `Transcript/Subtitles:\n${metadata.subtitles}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 4096,
    messages: [
      {
        role: "system",
        content: `You analyze social media content based on available metadata and transcripts. Provide structured analysis in JSON format with these fields:
- "title": A concise descriptive title for this content
- "summary": A comprehensive 2-4 paragraph summary
- "keyTopics": An array of 3-8 key topics or themes
- "insights": Detailed insights, takeaways, or notable points

Be thorough and extract as much useful information as possible from the available text.`,
      },
      {
        role: "user",
        content: `Analyze this content:\n\n${context}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title || metadata.title,
      summary: parsed.summary || "",
      keyTopics: parsed.keyTopics || [],
      insights: parsed.insights || "",
    };
  } catch {
    return { title: metadata.title, summary: raw, keyTopics: [], insights: "" };
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/content/video", async (req: Request, res: Response) => {
    const { url, mode } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    const [item] = await db
      .insert(contentItems)
      .values({
        type: "video",
        title: "Processing...",
        url,
        analysisMode: mode || "metadata",
        summary: "",
        status: "processing",
      })
      .returning();

    res.json(item);

    try {
      if (mode === "multimodal") {
        const { frames, audioBuffer, metadata } = await downloadAndExtractFrames(url);

        let transcript = "";
        if (audioBuffer && audioBuffer.length > 1000) {
          transcript = await transcribeAudio(audioBuffer);
        }

        const analysis = await analyzeWithVision(
          frames,
          transcript,
          metadata.description || "",
        );

        await db
          .update(contentItems)
          .set({
            title: analysis.title,
            summary: analysis.summary,
            transcript: transcript || metadata.subtitles || null,
            keyTopics: JSON.stringify(analysis.keyTopics),
            insights: analysis.insights,
            rawCaption: metadata.description || null,
            thumbnailData: frames[0] || null,
            status: "complete",
          })
          .where(eq(contentItems.id, item.id));
      } else {
        const metadata = await getVideoMetadata(url);
        const analysis = await analyzeTextContent(metadata);

        await db
          .update(contentItems)
          .set({
            title: analysis.title,
            summary: analysis.summary,
            transcript: metadata.subtitles || null,
            keyTopics: JSON.stringify(analysis.keyTopics),
            insights: analysis.insights,
            rawCaption: metadata.description || null,
            status: "complete",
          })
          .where(eq(contentItems.id, item.id));
      }
    } catch (error: any) {
      console.error("Video analysis failed:", error);
      await db
        .update(contentItems)
        .set({
          status: "error",
          errorMessage: error.message || "Analysis failed",
        })
        .where(eq(contentItems.id, item.id));
    }
  });

  app.post("/api/content/carousel", async (req: Request, res: Response) => {
    const { images, url } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: "At least one image is required" });
    }

    const [item] = await db
      .insert(contentItems)
      .values({
        type: "carousel",
        title: "Processing...",
        url: url || null,
        summary: "",
        status: "processing",
      })
      .returning();

    for (let i = 0; i < images.length; i++) {
      await db.insert(contentImages).values({
        contentId: item.id,
        imageData: images[i],
        orderIndex: i,
      });
    }

    res.json(item);

    try {
      let caption = "";
      if (url) {
        caption = await getInstagramCaption(url);
      }

      const analysis = await analyzeWithVision(images, "", caption);

      await db
        .update(contentItems)
        .set({
          title: analysis.title,
          summary: analysis.summary,
          keyTopics: JSON.stringify(analysis.keyTopics),
          insights: analysis.insights,
          rawCaption: caption || null,
          thumbnailData: images[0] || null,
          status: "complete",
        })
        .where(eq(contentItems.id, item.id));
    } catch (error: any) {
      console.error("Carousel analysis failed:", error);
      await db
        .update(contentItems)
        .set({
          status: "error",
          errorMessage: error.message || "Analysis failed",
        })
        .where(eq(contentItems.id, item.id));
    }
  });

  app.get("/api/content", async (_req: Request, res: Response) => {
    try {
      const items = await db
        .select()
        .from(contentItems)
        .orderBy(desc(contentItems.createdAt));
      res.json(items);
    } catch (error) {
      console.error("Error fetching content:", error);
      res.status(500).json({ error: "Failed to fetch content" });
    }
  });

  app.get("/api/content/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const [item] = await db
        .select()
        .from(contentItems)
        .where(eq(contentItems.id, id));

      if (!item) {
        return res.status(404).json({ error: "Content not found" });
      }

      const images = await db
        .select()
        .from(contentImages)
        .where(eq(contentImages.contentId, id))
        .orderBy(contentImages.orderIndex);

      const qa = await db
        .select()
        .from(qaMessages)
        .where(eq(qaMessages.contentId, id))
        .orderBy(qaMessages.createdAt);

      res.json({ ...item, images, qa });
    } catch (error) {
      console.error("Error fetching content:", error);
      res.status(500).json({ error: "Failed to fetch content" });
    }
  });

  app.delete("/api/content/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(qaMessages).where(eq(qaMessages.contentId, id));
      await db.delete(contentImages).where(eq(contentImages.contentId, id));
      await db.delete(contentItems).where(eq(contentItems.id, id));
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting content:", error);
      res.status(500).json({ error: "Failed to delete content" });
    }
  });

  app.post("/api/content/:id/qa", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const { question } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Question is required" });
      }

      const [item] = await db
        .select()
        .from(contentItems)
        .where(eq(contentItems.id, id));

      if (!item) {
        return res.status(404).json({ error: "Content not found" });
      }

      await db.insert(qaMessages).values({
        contentId: id,
        role: "user",
        content: question,
      });

      const previousQa = await db
        .select()
        .from(qaMessages)
        .where(eq(qaMessages.contentId, id))
        .orderBy(qaMessages.createdAt);

      const contextParts = [
        `Content Title: ${item.title}`,
        `Type: ${item.type}`,
        item.summary ? `Summary: ${item.summary}` : "",
        item.transcript ? `Transcript: ${item.transcript}` : "",
        item.insights ? `Insights: ${item.insights}` : "",
        item.keyTopics ? `Key Topics: ${item.keyTopics}` : "",
        item.rawCaption ? `Original Caption: ${item.rawCaption}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const chatHistory: any[] = [
        {
          role: "system",
          content: `You are a helpful assistant answering questions about analyzed social media content. Here is the context about the content:\n\n${contextParts}\n\nAnswer questions based on this information. Be concise but thorough.`,
        },
      ];

      for (const msg of previousQa) {
        chatHistory.push({ role: msg.role, content: msg.content });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: chatHistory,
        stream: true,
        max_completion_tokens: 4096,
      });

      let fullResponse = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      await db.insert(qaMessages).values({
        contentId: id,
        role: "assistant",
        content: fullResponse,
      });

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      console.error("Error in Q&A:", error);
      if (res.headersSent) {
        res.write(
          `data: ${JSON.stringify({ error: "Failed to process question" })}\n\n`,
        );
        res.end();
      } else {
        res.status(500).json({ error: "Failed to process question" });
      }
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
