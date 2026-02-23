import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { db } from "./db";
import { localdb } from "./localdb";
import { contentItems, contentImages, qaMessages } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import {
  getVideoMetadata,
  downloadVideo,
  prepareVideoForGemini,
  getInstagramCaption,
  cleanupWorkDir,
} from "./utils/video";
import { batchProcess } from "./replit_integrations/batch";

let openai: any = null;
try {
  openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  if (openai) console.log("OpenAI client initialized");
} catch (err: any) {
  console.warn("OpenAI client initialization failed:", err?.message || err);
}

let gemini: any = null;
try {
  gemini = new GoogleGenAI({
    apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    httpOptions: {
      apiVersion: "",
      baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    },
  });
  if (gemini) console.log("Gemini client initialized");
} catch (err: any) {
  console.warn("Gemini client initialization failed:", err?.message || err);
}

async function generateText({ model, messages, maxTokens }: { model: string; messages: any[]; maxTokens?: number; }) {
  // Prefer OpenAI if available
  if (openai) {
    return await openai.chat.completions.create({ model, messages, max_completion_tokens: maxTokens || 8192 });
  }

  if (!gemini) {
    throw new Error("No text-generation provider available (OpenAI or Gemini)");
  }

  // Convert messages array to Gemini parts
  const parts: any[] = messages.map((m) => ({ type: 'text', text: m.content || m }));
  const response = await gemini.models.generateContent({ model: "gemini-2.5-flash", contents: [{ role: 'user', parts }], config: { maxOutputTokens: maxTokens || 8192 } });
  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return { choices: [{ message: { content: text } }] } as any;
}

const useLocal = !process.env.DATABASE_URL;

async function analyzeVideoWithGemini(
  videoChunks: { data: string; mimeType: string }[],
  caption: string,
): Promise<{ title: string; summary: string; keyTopics: string[]; insights: string; transcript: string }> {
  const chunkResults = await batchProcess(
    videoChunks,
    async (chunk, index) => {
      const parts: any[] = [
        { inlineData: { mimeType: chunk.mimeType, data: chunk.data } },
        {
          text: `Analyze this video segment (part ${index + 1} of ${videoChunks.length}).
${caption ? `Original caption: ${caption}` : ""}

Provide a JSON response with:
- "transcript": Full transcription of all spoken words/dialogue in this segment
- "visualDescription": Detailed description of what's shown visually
- "keyPoints": Array of key points or topics covered
- "mood": The overall mood/tone`,
        },
      ];

      const response = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts }],
        config: { maxOutputTokens: 8192 },
      });

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
      try {
        return JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text);
      } catch {
        return { transcript: "", visualDescription: text, keyPoints: [], mood: "" };
      }
    },
    { concurrency: 1, retries: 5 },
  );

  const combinedTranscript = chunkResults.map((r: any) => r.transcript || "").filter(Boolean).join(" ");
  const combinedVisuals = chunkResults.map((r: any) => r.visualDescription || "").filter(Boolean).join("\n\n");
  const allKeyPoints = chunkResults.flatMap((r: any) => r.keyPoints || []);

  const synthesisResponse = await generateText({
    model: "gpt-5.2",
    maxTokens: 8192,
    messages: [
      {
        role: "system",
        content: `You synthesize multi-segment video analysis into a cohesive final analysis. Return JSON with:
- "title": A concise descriptive title
- "summary": A comprehensive 2-4 paragraph summary
- "keyTopics": Array of 3-8 key topics or themes
- "insights": Detailed insights, takeaways, or notable points`,
      },
      {
        role: "user",
        content: `Synthesize this video analysis:\n\nVisual Content: ${combinedVisuals}\n\nTranscript: ${combinedTranscript || "No spoken words detected"}\n\nKey Points: ${JSON.stringify(allKeyPoints)}\n\n${caption ? `Original Caption: ${caption}` : ""}`,
      },
    ],
  });

  const raw = synthesisResponse.choices[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title || "Untitled",
      summary: parsed.summary || "",
      keyTopics: parsed.keyTopics || [],
      insights: parsed.insights || "",
      transcript: combinedTranscript,
    };
  } catch {
    return { title: "Untitled", summary: raw, keyTopics: [], insights: "", transcript: combinedTranscript };
  }
}

async function analyzeWithVision(
  frames: string[],
  transcript: string,
  caption: string,
): Promise<{ title: string; summary: string; keyTopics: string[]; insights: string }> {
  const imageMessages: any[] = frames.slice(0, 10).map((frame) => ({
    type: "image_url",
    image_url: { url: `data:image/jpeg;base64,${frame}`, detail: "low" },
  }));

  const textContext = [];
  if (transcript) textContext.push(`Transcript:\n${transcript}`);
  if (caption) textContext.push(`Caption:\n${caption}`);

  const response = await generateText({
    model: "gpt-5.2",
    maxTokens: 8192,
    messages: [
      {
        role: "system",
        content: `You analyze social media content (videos, reels, carousel posts). Provide structured analysis in JSON format with these fields:\n- \"title\": A concise descriptive title for this content\n- \"summary\": A comprehensive 2-4 paragraph summary of what the content is about\n- \"keyTopics\": An array of 3-8 key topics or themes covered\n- \"insights\": Detailed insights, takeaways, or notable points from the content\n\nBe thorough and informative. Extract as much useful information as possible.`,
      },
      {
        role: "user",
        content: textContext.length > 0
          ? `Analyze this content:\n\n${textContext.join("\n\n")}`
          : "Analyze this visual content thoroughly.",
      },
    ],
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

  const response = await generateText({
    model: "gpt-5.2",
    maxTokens: 8192,
    messages: [
      {
        role: "system",
        content: `You analyze social media content based on available metadata and transcripts. Provide structured analysis in JSON format with these fields:\n- \"title\": A concise descriptive title for this content\n- \"summary\": A comprehensive 2-4 paragraph summary\n- \"keyTopics\": An array of 3-8 key topics or themes\n- \"insights\": Detailed insights, takeaways, or notable points\n\nBe thorough and extract as much useful information as possible from the available text.`,
      },
      {
        role: "user",
        content: `Analyze this content:\n\n${context}`,
      },
    ],
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

    let item: any;
    if (useLocal) {
      item = localdb.insertContent({
        type: "video",
        title: "Processing...",
        url,
        analysisMode: mode || "metadata",
        summary: "",
        status: "processing",
      });
      res.json(item);
    } else {
      const [dbItem] = await db
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
      item = dbItem;
      res.json(item);
    }

    try {
      if (mode === "multimodal") {
        const { videoPath, workDir, metadata } = await downloadVideo(url);

        try {
          const { chunks, thumbnailBase64 } = await prepareVideoForGemini(videoPath);

          if (chunks.length === 0) {
            throw new Error("Failed to prepare video for analysis - file may be too large or corrupted");
          }

          const analysis = await analyzeVideoWithGemini(chunks, metadata.description || "");
          if (useLocal) {
            localdb.updateContent(item.id, {
              title: analysis.title,
              summary: analysis.summary,
              transcript: analysis.transcript || metadata.subtitles || null,
              keyTopics: JSON.stringify(analysis.keyTopics),
              insights: analysis.insights,
              rawCaption: metadata.description || null,
              thumbnailData: thumbnailBase64 || null,
              status: "complete",
            } as any);
          } else {
            await db
              .update(contentItems)
              .set({
                title: analysis.title,
                summary: analysis.summary,
                transcript: analysis.transcript || metadata.subtitles || null,
                keyTopics: JSON.stringify(analysis.keyTopics),
                insights: analysis.insights,
                rawCaption: metadata.description || null,
                thumbnailData: thumbnailBase64 || null,
                status: "complete",
              })
              .where(eq(contentItems.id, item.id));
          }
        } finally {
          await cleanupWorkDir(workDir);
        }
      } else {
        const metadata = await getVideoMetadata(url);
        const analysis = await analyzeTextContent(metadata);
        if (useLocal) {
          localdb.updateContent(item.id, {
            title: analysis.title,
            summary: analysis.summary,
            transcript: metadata.subtitles || null,
            keyTopics: JSON.stringify(analysis.keyTopics),
            insights: analysis.insights,
            rawCaption: metadata.description || null,
            status: "complete",
          } as any);
        } else {
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
      }
    } catch (error: any) {
      console.error("Video analysis failed:", error);
      if (useLocal) {
        localdb.updateContent(item.id, { status: "error", errorMessage: error.message || "Analysis failed" } as any);
      } else {
        await db
          .update(contentItems)
          .set({
            status: "error",
            errorMessage: error.message || "Analysis failed",
          })
          .where(eq(contentItems.id, item.id));
      }
    }
  });

  app.post("/api/content/carousel", async (req: Request, res: Response) => {
    const { images, url } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: "At least one image is required" });
    }

    let item: any;
    if (useLocal) {
      item = localdb.insertContent({ type: "carousel", title: "Processing...", url: url || null, summary: "", status: "processing" });
      for (let i = 0; i < images.length; i++) {
        localdb.insertImage(item.id, images[i], i);
      }
      res.json(item);
    } else {
      const [dbItem] = await db
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
          contentId: dbItem.id,
          imageData: images[i],
          orderIndex: i,
        });
      }

      item = dbItem;
      res.json(item);
    }

    try {
      let caption = "";
      if (url) {
        caption = await getInstagramCaption(url);
      }

      const analysis = await analyzeWithVision(images, "", caption);

      if (useLocal) {
        localdb.updateContent(item.id, {
          title: analysis.title,
          summary: analysis.summary,
          keyTopics: JSON.stringify(analysis.keyTopics),
          insights: analysis.insights,
          rawCaption: caption || null,
          thumbnailData: images[0] || null,
          status: "complete",
        } as any);
      } else {
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
      }
    } catch (error: any) {
      console.error("Carousel analysis failed:", error);
      if (useLocal) {
        localdb.updateContent(item.id, { status: "error", errorMessage: error.message || "Analysis failed" } as any);
      } else {
        await db
          .update(contentItems)
          .set({
            status: "error",
            errorMessage: error.message || "Analysis failed",
          })
          .where(eq(contentItems.id, item.id));
      }
    }
  });

  app.get("/api/content", async (_req: Request, res: Response) => {
    try {
      if (useLocal) {
        const items = localdb.getAllContent();
        return res.json(items);
      }

      const items = await db
        .select()
        .from(contentItems)
        .orderBy(desc(contentItems.createdAt));
      res.json(items);
    } catch (error) {
      console.error("Error fetching content (DB unavailable):", error);
      res.json([]);
    }
  });

  app.get("/api/content/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (useLocal) {
        const item = localdb.getContentById(id);
        if (!item) return res.status(404).json({ error: "Content not found" });
        return res.json(item);
      }

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
      const id = parseInt(String(req.params.id));
      if (useLocal) {
        localdb.deleteContent(id);
        return res.status(204).send();
      }

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
      const id = parseInt(String(req.params.id));
      const { question } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Question is required" });
      }

      let item: any;
      if (useLocal) {
        item = localdb.getContentById(id);
        if (!item) return res.status(404).json({ error: "Content not found" });
        localdb.insertQa(id, "user", question);
      } else {
        const [dbItem] = await db
          .select()
          .from(contentItems)
          .where(eq(contentItems.id, id));
        if (!dbItem) return res.status(404).json({ error: "Content not found" });
        item = dbItem;
        await db.insert(qaMessages).values({ contentId: id, role: "user", content: question });
      }

      const previousQa = useLocal
        ? (localdb.getContentById(id)?.qa || [])
        : await db.select().from(qaMessages).where(eq(qaMessages.contentId, id)).orderBy(qaMessages.createdAt);

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

      let fullResponse = "";
      if (openai) {
        const stream = await openai.chat.completions.create({ model: "gpt-5.2", messages: chatHistory, stream: true, max_completion_tokens: 8192 });
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            fullResponse += content;
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          }
        }
      } else {
        // Fallback to Gemini (non-streaming)
        const resp = await generateText({ model: "gpt-5.2", messages: chatHistory, maxTokens: 8192 });
        fullResponse = resp.choices[0]?.message?.content || "";
        if (fullResponse) {
          res.write(`data: ${JSON.stringify({ content: fullResponse })}\n\n`);
        }
      }

      if (useLocal) {
        localdb.insertQa(id, "assistant", fullResponse);
      } else {
        await db.insert(qaMessages).values({ contentId: id, role: "assistant", content: fullResponse });
      }

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
