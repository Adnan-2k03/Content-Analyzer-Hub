import * as fs from "fs";
import * as path from "path";
import type { ContentItem, ContentImage, QAMessage } from "@shared/schema";

const DB_PATH = path.resolve(process.cwd(), "server", "localdb.json");

type LocalDB = {
  contentItems: ContentItem[];
  contentImages: ContentImage[];
  qaMessages: QAMessage[];
  nextContentId: number;
  nextImageId: number;
  nextQaId: number;
};

function ensureDb(): LocalDB {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const base: LocalDB = { contentItems: [], contentImages: [], qaMessages: [], nextContentId: 1, nextImageId: 1, nextQaId: 1 };
      fs.writeFileSync(DB_PATH, JSON.stringify(base, null, 2));
      return base;
    }

    const raw = fs.readFileSync(DB_PATH, "utf-8");
    return JSON.parse(raw) as LocalDB;
  } catch (err) {
    const base: LocalDB = { contentItems: [], contentImages: [], qaMessages: [], nextContentId: 1, nextImageId: 1, nextQaId: 1 };
    try { fs.writeFileSync(DB_PATH, JSON.stringify(base, null, 2)); } catch {}
    return base;
  }
}

function saveDb(db: LocalDB) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export const localdb = {
  getAllContent(): ContentItem[] {
    const db = ensureDb();
    return db.contentItems.slice().sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  },
  getContentById(id: number): (ContentItem & { images: ContentImage[]; qa: QAMessage[] }) | undefined {
    const db = ensureDb();
    const item = db.contentItems.find((c) => c.id === id);
    if (!item) return undefined;
    const images = db.contentImages.filter((img) => img.contentId === id).sort((a, b) => a.orderIndex - b.orderIndex);
    const qa = db.qaMessages.filter((m) => m.contentId === id).sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
    return { ...item, images, qa };
  },
  insertContent(item: Partial<ContentItem>): ContentItem {
    const db = ensureDb();
    const id = db.nextContentId++;
    const now = new Date().toISOString();
    const newItem: ContentItem = {
      id,
      type: (item.type as any) || "carousel",
      title: (item.title as any) || "",
      url: (item.url as any) || null,
      analysisMode: (item.analysisMode as any) || null,
      summary: (item.summary as any) || "",
      transcript: (item.transcript as any) || null,
      keyTopics: (item.keyTopics as any) || null,
      insights: (item.insights as any) || null,
      rawCaption: (item.rawCaption as any) || null,
      thumbnailData: (item.thumbnailData as any) || null,
      status: (item.status as any) || "processing",
      errorMessage: (item.errorMessage as any) || null,
      createdAt: new Date(now),
    } as ContentItem;
    db.contentItems.push(newItem);
    saveDb(db);
    return newItem;
  },
  updateContent(id: number, patch: Partial<ContentItem>) {
    const db = ensureDb();
    const idx = db.contentItems.findIndex((c) => c.id === id);
    if (idx === -1) return;
    db.contentItems[idx] = { ...db.contentItems[idx], ...patch } as ContentItem;
    saveDb(db);
  },
  deleteContent(id: number) {
    const db = ensureDb();
    db.contentItems = db.contentItems.filter((c) => c.id !== id);
    db.contentImages = db.contentImages.filter((i) => i.contentId !== id);
    db.qaMessages = db.qaMessages.filter((q) => q.contentId !== id);
    saveDb(db);
  },
  insertImage(contentId: number, imageData: string, orderIndex: number) {
    const db = ensureDb();
    const id = db.nextImageId++;
    const img: ContentImage = { id, contentId, imageData, orderIndex } as ContentImage;
    db.contentImages.push(img);
    saveDb(db);
    return img;
  },
  insertQa(contentId: number, role: string, content: string) {
    const db = ensureDb();
    const id = db.nextQaId++;
    const createdAt = new Date();
    const msg: QAMessage = { id, contentId, role, content, createdAt } as QAMessage;
    db.qaMessages.push(msg);
    saveDb(db);
    return msg;
  },
};
